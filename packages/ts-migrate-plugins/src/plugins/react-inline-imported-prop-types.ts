import ts from 'typescript';
import path from 'path';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { updateImports, DefaultImport, NamedImport, ModuleImport } from './utils/imports';
import { collectIdentifiers } from './utils/identifiers';
import { unpackInitializer } from './utils/react-props';

/**
 * Copies propTypes objects imported from other modules into the file that
 * assigns them (`Cmp.propTypes = importedPropTypes`, `static propTypes`, and
 * spreads inside colocated literals), so the downstream react-props plugin
 * converts them structurally like colocated propTypes. Imports the copied
 * text still needs are carried over with re-resolved relative specifiers, and
 * the original import is removed once unused. Candidates that can't be copied
 * faithfully (non-relative modules, non-literal exports, references to
 * module-local values) are left alone; react-props falls back to
 * InferProps<typeof x> for those.
 */
// One program snapshot serves a whole pass: this plugin only reads other
// modules' exported initializers and import declarations, which its own edits
// never modify (it rewrites consumer-side propTypes expressions, and import
// removal is usage-gated). Re-synchronizing the program after every edited
// file costs ~50ms per candidate on a 1000-file project for no benefit.
const programCache = new WeakMap<ts.LanguageService, ts.Program>();

const reactInlineImportedPropTypesPlugin: Plugin = {
  name: 'react-inline-imported-prop-types',

  run({ fileName, sourceFile, text, getLanguageService }) {
    if (!fileName.endsWith('.tsx')) return undefined;
    if (!text.includes('propTypes')) return undefined;

    const imports = collectImportBindings(sourceFile);
    if (imports.size === 0) return undefined;

    const candidates = findCandidates(sourceFile, imports);
    if (candidates.length === 0) return undefined;
    // Only relative specifiers ever resolve to project files.
    if (!candidates.some((cur) => cur.binding.moduleSpecifier.startsWith('.'))) return undefined;

    const program = getCachedProgram(getLanguageService());
    if (!program) return undefined;

    const normalizedFileName = fileName.replace(/\\/g, '/');
    const moduleFileCache = new Map<string, ts.SourceFile | undefined>();
    const resolveModuleFile = (specifier: string): ts.SourceFile | undefined => {
      if (moduleFileCache.has(specifier)) return moduleFileCache.get(specifier);
      let resolved: ts.SourceFile | undefined;
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(fileName), specifier).replace(/\\/g, '/');
        const stripped = base.replace(/\.(jsx?|tsx?)$/, '');
        const fileCandidates = [
          base,
          `${stripped}.tsx`,
          `${stripped}.ts`,
          `${stripped}.jsx`,
          `${stripped}.js`,
          `${stripped}/index.tsx`,
          `${stripped}/index.ts`,
        ];
        for (const fileCandidate of fileCandidates) {
          const file =
            fileCandidate === normalizedFileName ? undefined : program.getSourceFile(fileCandidate);
          if (file && !file.isDeclarationFile) {
            resolved = file;
            break;
          }
        }
      }
      moduleFileCache.set(specifier, resolved);
      return resolved;
    };

    const moduleScopeCache = new Map<ts.SourceFile, ModuleScope>();
    const getModuleScope = (moduleFile: ts.SourceFile): ModuleScope => {
      let scope = moduleScopeCache.get(moduleFile);
      if (!scope) {
        scope = buildModuleScope(moduleFile);
        moduleScopeCache.set(moduleFile, scope);
      }
      return scope;
    };

    const destinationIdentifiers = collectIdentifiers(sourceFile);
    const destinationImportSpecifiers = new Map<string, string>();
    imports.forEach((binding, localName) => {
      destinationImportSpecifiers.set(localName, binding.moduleSpecifier);
    });

    type InlineUpdate = {
      update: SourceTextUpdate;
      carriedImports: (DefaultImport | NamedImport)[];
    };

    const buildInlineUpdate = (candidate: Candidate): InlineUpdate | undefined => {
      const moduleFile = resolveModuleFile(candidate.binding.moduleSpecifier);
      if (!moduleFile) return undefined;

      const exported = findExportedExpression(moduleFile, candidate.exportName);
      if (!exported) return undefined;
      const { inner, wrapped: sourceWrapped } = unwrapForbidExtraProps(exported);
      if (!ts.isObjectLiteralExpression(inner)) return undefined;

      let copyRoot: ts.Node;
      let copyText: string;
      if (candidate.kind === 'assignment') {
        copyRoot = candidate.destinationWrapped ? inner : exported;
        copyText = copyRoot.getText(moduleFile);
      } else {
        // Splicing members into an existing literal: a wrapper call or an
        // empty object can't be represented as a member list.
        if (sourceWrapped || inner.properties.length === 0) return undefined;
        copyRoot = inner;
        const first = inner.properties[0];
        const last = inner.properties[inner.properties.length - 1];
        copyText = moduleFile.text.slice(first.getStart(moduleFile), last.end);
      }

      const carried = classifyFreeIdentifiers(copyRoot, getModuleScope(moduleFile));
      if (!carried) return undefined;

      let collides = false;
      const carriedImports: (DefaultImport | NamedImport)[] = [];
      carried.forEach((binding, localName) => {
        const specifier = retargetSpecifier(binding.moduleSpecifier, moduleFile.fileName, fileName);
        if (
          destinationIdentifiers.has(localName) &&
          destinationImportSpecifiers.get(localName) !== specifier
        ) {
          collides = true;
          return;
        }
        carriedImports.push(
          binding.kind === 'default'
            ? { defaultImport: localName, moduleSpecifier: specifier }
            : { namedImport: localName, moduleSpecifier: specifier },
        );
      });
      if (collides) return undefined;

      const start = candidate.target.getStart(sourceFile);
      return {
        update: {
          kind: 'replace',
          index: start,
          length: candidate.target.end - start,
          text: copyText,
        },
        carriedImports,
      };
    };

    const updates: SourceTextUpdate[] = [];
    const carriedImports: (DefaultImport | NamedImport)[] = [];
    const inlinedBindings = new Set<ImportBinding>();

    for (const candidate of candidates) {
      const inlined = buildInlineUpdate(candidate);
      if (inlined) {
        updates.push(inlined.update);
        carriedImports.push(...inlined.carriedImports);
        inlinedBindings.add(candidate.binding);
      }
    }

    if (updates.length === 0) return undefined;

    const updatedSourceText = updateSourceText(text, updates);
    const updatedSourceFile = ts.createSourceFile(
      fileName,
      updatedSourceText,
      sourceFile.languageVersion,
    );
    const removeImports: (DefaultImport | NamedImport | ModuleImport)[] = [];
    inlinedBindings.forEach((binding) => {
      if (binding.kind === 'named') {
        removeImports.push({
          namedImport: binding.localName,
          moduleSpecifier: binding.moduleSpecifier,
        });
      } else if (binding.kind === 'default') {
        removeImports.push({
          defaultImport: binding.localName,
          moduleSpecifier: binding.moduleSpecifier,
        });
      } else {
        removeImports.push({ moduleSpecifier: binding.moduleSpecifier });
      }
    });
    const importUpdates = updateImports(updatedSourceFile, carriedImports, removeImports);
    return updateSourceText(updatedSourceText, importUpdates);
  },
};

export default reactInlineImportedPropTypesPlugin;

function getCachedProgram(languageService: ts.LanguageService): ts.Program | undefined {
  let program = programCache.get(languageService);
  if (!program) {
    program = languageService.getProgram() ?? undefined;
    if (program) programCache.set(languageService, program);
  }
  return program;
}

type ImportBinding = {
  kind: 'default' | 'named' | 'namespace';
  localName: string;
  importedName: string;
  moduleSpecifier: string;
  aliased: boolean;
};

type ModuleScope = {
  locals: Set<string>;
  imports: Map<string, ImportBinding>;
};

type Candidate = {
  kind: 'assignment' | 'spread';
  target: ts.Expression | ts.SpreadAssignment;
  binding: ImportBinding;
  exportName: string;
  destinationWrapped: boolean;
};

function collectImportBindings(sourceFile: ts.SourceFile): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleSpecifier = statement.moduleSpecifier.text;
      const { importClause } = statement;
      if (importClause) {
        if (importClause.name) {
          bindings.set(importClause.name.text, {
            kind: 'default',
            localName: importClause.name.text,
            importedName: 'default',
            moduleSpecifier,
            aliased: false,
          });
        }
        if (importClause.namedBindings) {
          if (ts.isNamespaceImport(importClause.namedBindings)) {
            bindings.set(importClause.namedBindings.name.text, {
              kind: 'namespace',
              localName: importClause.namedBindings.name.text,
              importedName: '*',
              moduleSpecifier,
              aliased: false,
            });
          } else {
            importClause.namedBindings.elements.forEach((specifier) => {
              bindings.set(specifier.name.text, {
                kind: 'named',
                localName: specifier.name.text,
                importedName: (specifier.propertyName ?? specifier.name).text,
                moduleSpecifier,
                aliased: specifier.propertyName != null,
              });
            });
          }
        }
      }
    }
  }
  return bindings;
}

function findCandidates(
  sourceFile: ts.SourceFile,
  imports: Map<string, ImportBinding>,
): Candidate[] {
  const candidates: Candidate[] = [];
  const initializers: ts.Expression[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      ts.isIdentifier(statement.expression.left.name) &&
      statement.expression.left.name.text === 'propTypes'
    ) {
      initializers.push(statement.expression.right);
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (
          ts.isPropertyDeclaration(member) &&
          member.modifiers != null &&
          member.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
          ts.isIdentifier(member.name) &&
          member.name.text === 'propTypes' &&
          member.initializer != null
        ) {
          initializers.push(member.initializer);
        }
      }
    }
  }

  const seenLiterals = new Set<ts.ObjectLiteralExpression>();
  for (const initializer of initializers) {
    const { inner, wrapped } = unwrapForbidExtraProps(initializer);
    const resolved = resolveImportedEntity(inner, imports);
    if (resolved) {
      candidates.push({
        kind: 'assignment',
        target: inner,
        binding: resolved.binding,
        exportName: resolved.exportName,
        destinationWrapped: wrapped,
      });
    } else {
      const literal = unpackInitializer(initializer, sourceFile);
      if (literal && !seenLiterals.has(literal)) {
        seenLiterals.add(literal);
        for (const property of literal.properties) {
          if (ts.isSpreadAssignment(property)) {
            const spreadResolved = resolveImportedEntity(property.expression, imports);
            if (spreadResolved) {
              candidates.push({
                kind: 'spread',
                target: property,
                binding: spreadResolved.binding,
                exportName: spreadResolved.exportName,
                destinationWrapped: false,
              });
            }
          }
        }
      }
    }
  }

  return candidates;
}

function resolveImportedEntity(
  expression: ts.Expression,
  imports: Map<string, ImportBinding>,
): { binding: ImportBinding; exportName: string } | undefined {
  if (ts.isIdentifier(expression)) {
    const binding = imports.get(expression.text);
    if (binding && binding.kind !== 'namespace') {
      return { binding, exportName: binding.importedName };
    }
    return undefined;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ts.isIdentifier(expression.name)
  ) {
    const binding = imports.get(expression.expression.text);
    if (binding && binding.kind === 'namespace') {
      return { binding, exportName: expression.name.text };
    }
  }
  return undefined;
}

function unwrapForbidExtraProps(expression: ts.Expression): {
  inner: ts.Expression;
  wrapped: boolean;
} {
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'forbidExtraProps' &&
    expression.arguments.length === 1
  ) {
    return { inner: expression.arguments[0], wrapped: true };
  }
  return { inner: expression, wrapped: false };
}

function findExportedExpression(
  moduleFile: ts.SourceFile,
  exportName: string,
): ts.Expression | undefined {
  const followLocal = (expression: ts.Expression | undefined): ts.Expression | undefined => {
    let current = expression;
    const seen = new Set<string>();
    while (current && ts.isIdentifier(current) && !seen.has(current.text)) {
      seen.add(current.text);
      current = findTopLevelVariableInitializer(moduleFile, current.text, false);
    }
    return current && ts.isIdentifier(current) ? undefined : current;
  };

  if (exportName === 'default') {
    for (const statement of moduleFile.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        return followLocal(statement.expression);
      }
    }
    return undefined;
  }

  const direct = findTopLevelVariableInitializer(moduleFile, exportName, true);
  if (direct) {
    return followLocal(direct);
  }

  for (const statement of moduleFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === exportName) {
          const localName = (element.propertyName ?? element.name).text;
          return followLocal(findTopLevelVariableInitializer(moduleFile, localName, false));
        }
      }
    }
  }

  return undefined;
}

function findTopLevelVariableInitializer(
  moduleFile: ts.SourceFile,
  name: string,
  requireExport: boolean,
): ts.Expression | undefined {
  for (const statement of moduleFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      (!requireExport ||
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          return declaration.initializer;
        }
      }
    }
  }
  return undefined;
}

function buildModuleScope(moduleFile: ts.SourceFile): ModuleScope {
  const locals = new Set<string>();
  for (const statement of moduleFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, locals);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      locals.add(statement.name.text);
    }
  }
  return { locals, imports: collectImportBindings(moduleFile) };
}

function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNames(element.name, out);
    }
  }
}

/**
 * Identifiers referenced by the copied expression must resolve identically in
 * the destination file: imports it can re-create there are carried over,
 * globals are copyable as-is, and anything bound locally in the source module
 * (or via imports it can't re-create) makes the candidate uncopyable.
 */
function classifyFreeIdentifiers(
  root: ts.Node,
  scope: ModuleScope,
): Map<string, ImportBinding> | null {
  const freeIdentifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      freeIdentifiers.add(node.text);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name.expression);
      visit(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      freeIdentifiers.add(node.name.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);

  const carried = new Map<string, ImportBinding>();
  let copyable = true;
  freeIdentifiers.forEach((name) => {
    const binding = scope.imports.get(name);
    if (binding) {
      if (binding.kind === 'namespace' || binding.aliased) {
        copyable = false;
      } else {
        carried.set(name, binding);
      }
    } else if (scope.locals.has(name)) {
      copyable = false;
    }
  });
  return copyable ? carried : null;
}

function retargetSpecifier(specifier: string, fromFile: string, toFile: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const absoluteTarget = path.resolve(path.dirname(fromFile), specifier);
  let relative = path.relative(path.dirname(toFile), absoluteTarget).replace(/\\/g, '/');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}
