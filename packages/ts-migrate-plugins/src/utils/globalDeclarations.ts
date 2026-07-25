import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';

/** Where a declaration has to go for the assignment that produced it to resolve. */
export type GlobalTarget = 'window' | 'globalThis';

/**
 * The environment objects whose properties are globals. `self` is left out: a
 * local `self` holding a captured `this` is far more common in the code being
 * migrated than a worker global, and every one of those would become a
 * declaration for a property that is not global at all.
 */
const GLOBAL_ROOTS: { [name: string]: GlobalTarget } = {
  window: 'window',
  global: 'globalThis',
  globalThis: 'globalThis',
};

export interface GlobalProperty {
  name: string;
  target: GlobalTarget;
  /** One entry per distinct type an assignment said the property has. */
  types: Set<string>;
  /** Set when an assigned expression does not say what its type is. */
  unknownType: boolean;
  files: Set<string>;
  assignments: number;
}

export interface GlobalAssignmentEvidence {
  properties: Map<string, GlobalProperty>;
}

export function createGlobalAssignmentEvidence(): GlobalAssignmentEvidence {
  return { properties: new Map() };
}

const LITERAL_TYPES: { [kind: number]: string } = {
  [ts.SyntaxKind.StringLiteral]: 'string',
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: 'string',
  [ts.SyntaxKind.TemplateExpression]: 'string',
  [ts.SyntaxKind.NumericLiteral]: 'number',
  [ts.SyntaxKind.BigIntLiteral]: 'bigint',
  [ts.SyntaxKind.TrueKeyword]: 'boolean',
  [ts.SyntaxKind.FalseKeyword]: 'boolean',
  [ts.SyntaxKind.NullKeyword]: 'null',
};

/**
 * The type of an assigned expression, for the expressions that say what their
 * type is on their own. Everything else is left undefined and falls back to
 * the any alias.
 *
 * The checker is deliberately not asked. A type read off it names the symbols
 * it is built from, and a symbol local to the file it came from does not
 * resolve inside a declaration file; a type read off an `any` says nothing
 * while looking like it does, and a wrong type here type-checks everywhere.
 */
export function assignedType(expression: ts.Expression): string | undefined {
  const literal = LITERAL_TYPES[expression.kind];
  if (literal) return literal;
  if (ts.isVoidExpression(expression)) return 'undefined';
  if (ts.isIdentifier(expression) && expression.text === 'undefined') return 'undefined';
  if (ts.isPrefixUnaryExpression(expression)) {
    if (expression.operator === ts.SyntaxKind.ExclamationToken) return 'boolean';
    if (
      (expression.operator === ts.SyntaxKind.MinusToken ||
        expression.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(expression.operand)
    ) {
      return 'number';
    }
  }
  return undefined;
}

/**
 * Every name the file binds itself. `window` as an IIFE parameter or a
 * `const global = {}` is a local, and its properties are not globals. The
 * whole file is disqualified for that name rather than the enclosing scope
 * alone: the cost of missing a real global is one suppression, the cost of
 * declaring a local's property is a global that does not exist.
 */
function locallyBoundNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addName = (name: ts.BindingName | ts.Identifier | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    name.elements.forEach((element) => {
      if (ts.isBindingElement(element)) addName(element.name);
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      addName(node.name);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)
    ) {
      addName(node.name);
    } else if (ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
      addName(node.name);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

/**
 * Whether the environment already declares this property, so no declaration is
 * needed: the lib and `@types` files declare it, or a previous run's file does.
 * Reported true as well when the environment object itself does not resolve,
 * since nothing added to `Window` helps a project that has no `window`.
 */
function environmentDeclares(
  checker: ts.TypeChecker,
  access: ts.PropertyAccessExpression,
): boolean {
  const objectType = checker.getTypeAtLocation(access.expression);
  if (objectType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  return checker.getPropertyOfType(objectType, access.name.text) !== undefined;
}

function record(
  evidence: GlobalAssignmentEvidence,
  name: string,
  target: GlobalTarget,
  fileName: string,
  type: string | undefined,
): void {
  let property = evidence.properties.get(name);
  if (!property) {
    property = {
      name,
      target,
      types: new Set(),
      unknownType: false,
      files: new Set(),
      assignments: 0,
    };
    evidence.properties.set(name, property);
  } else if (target === 'globalThis') {
    // A `var` on globalThis answers `window.x` too, while a Window member does
    // not answer `globalThis.x`, and declaring both intersects the two types.
    property.target = 'globalThis';
  }
  property.assignments += 1;
  property.files.add(fileName);
  if (type === undefined) {
    property.unknownType = true;
  } else {
    property.types.add(type);
  }
}

/**
 * Records every `window.x = ...`, `global.x = ...` and `globalThis.x = ...` in
 * the file, at any nesting depth: the polyfill guarded by an `if` and the
 * property set inside an install function are the normal shapes, and requiring
 * the top level would miss most of them.
 *
 * Only plain assignment counts, and only through a property name that is an
 * identifier. `window['x'] = 1` names nothing to declare, and `window.x += 1`
 * reads a property that something else already had to assign.
 */
export function collectGlobalAssignments({
  evidence,
  sourceFile,
  checker,
}: {
  evidence: GlobalAssignmentEvidence;
  sourceFile: ts.SourceFile;
  /** Skips the properties the environment declares already. */
  checker?: ts.TypeChecker;
}): void {
  const bound = locallyBoundNames(sourceFile);

  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      return;
    }
    const { left } = node;
    if (!ts.isPropertyAccessExpression(left) || !ts.isIdentifier(left.expression)) return;
    if (!ts.isIdentifier(left.name)) return;

    const rootName = left.expression.text;
    const target = GLOBAL_ROOTS[rootName];
    if (!target || bound.has(rootName)) return;
    if (checker && environmentDeclares(checker, left)) return;

    record(evidence, left.name.text, target, sourceFile.fileName, assignedType(node.right));
  };
  ts.forEachChild(sourceFile, visit);
}

const GENERATED_MARKER = '// Generated by ts-migrate.';

/** Where the generated global declarations live, relative to the migration root. */
export const GLOBAL_DECLARATIONS_FILE = 'types/ts-migrate-globals.d.ts';

function globalDeclarationsPath(rootDir: string): string {
  return path.join(rootDir, ...GLOBAL_DECLARATIONS_FILE.split('/'));
}

export interface GlobalDeclaration {
  name: string;
  target: GlobalTarget;
  type: string;
}

function byName(a: GlobalDeclaration, b: GlobalDeclaration): number {
  return a.name.localeCompare(b.name);
}

export function renderGlobalDeclarations(declarations: GlobalDeclaration[]): string {
  const sorted = [...declarations].sort(byName);
  const windowMembers = sorted.filter((declaration) => declaration.target === 'window');
  const globals = sorted.filter((declaration) => declaration.target === 'globalThis');

  const lines = [
    `${GENERATED_MARKER} Properties the code assigns to window and globalThis,`,
    '// declared once here so every read and write of them type-checks instead',
    '// of needing a cast at each site. Narrow a type to the real shape when you',
    '// know it and ts-migrate keeps your version. Delete an entry once',
    '// something else declares the property. Do not add entries by hand: the',
    '// file is rewritten from its own declarations on every run.',
    'export {};',
    '',
    'declare global {',
  ];
  if (windowMembers.length > 0) {
    lines.push('  interface Window {');
    windowMembers.forEach(({ name, type }) => lines.push(`    ${name}: ${type};`));
    lines.push('  }');
    if (globals.length > 0) lines.push('');
  }
  globals.forEach(({ name, type }) => lines.push(`  var ${name}: ${type};`));
  lines.push('}', '');
  return lines.join('\n');
}

/** `parseDiagnostics` is not on the public SourceFile, and is absent on older compilers. */
type ParsedSourceFile = ts.SourceFile & { parseDiagnostics?: readonly unknown[] };

function isGlobalAugmentation(statement: ts.Statement): statement is ts.ModuleDeclaration {
  return (
    ts.isModuleDeclaration(statement) &&
    (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0
  );
}

function isEmptyExport(statement: ts.Statement): boolean {
  return (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier === undefined &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length === 0
  );
}

/**
 * What a previously generated file declares, or null when the file is not one
 * this can rewrite without losing something: no generated marker (the file is
 * the user's), a parse error, or a declaration in a shape it did not write.
 *
 * The round trip goes through the parser rather than a regular expression, so
 * a file that has been reformatted still reads back. What it cannot read back
 * it refuses to overwrite, since a rewrite only keeps what this returns.
 */
export function parseGlobalDeclarations(text: string): GlobalDeclaration[] | null {
  if (!text.startsWith(GENERATED_MARKER)) return null;
  const sourceFile: ParsedSourceFile = ts.createSourceFile(
    'ts-migrate-globals.d.ts',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) return null;

  const declarations: GlobalDeclaration[] = [];
  let seenGlobal = false;

  for (const statement of sourceFile.statements) {
    if (isEmptyExport(statement)) continue;
    if (!isGlobalAugmentation(statement)) return null;
    const { body } = statement;
    if (!body || !ts.isModuleBlock(body)) return null;
    seenGlobal = true;

    for (const inner of body.statements) {
      if (ts.isInterfaceDeclaration(inner) && inner.name.text === 'Window') {
        for (const member of inner.members) {
          if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || !member.type) {
            return null;
          }
          declarations.push({
            name: member.name.text,
            target: 'window',
            type: member.type.getText(sourceFile),
          });
        }
      } else if (ts.isVariableStatement(inner)) {
        for (const declaration of inner.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.type) return null;
          declarations.push({
            name: declaration.name.text,
            target: 'globalThis',
            type: declaration.type.getText(sourceFile),
          });
        }
      } else {
        return null;
      }
    }
  }

  return seenGlobal ? declarations : null;
}

/**
 * The type to declare a property with: the union of what its assignments said,
 * or the any alias when any one of them said nothing.
 *
 * `null` and `undefined` on their own are dropped for the alias. They are
 * true of the assignment that produced them and useless everywhere else: every
 * read of the property becomes an error, which is worse than the cast the
 * declaration is replacing.
 */
function declaredType(property: GlobalProperty, anyType: string): string {
  if (property.unknownType) return anyType;
  const types = [...property.types].sort();
  if (types.length === 0) return anyType;
  if (types.every((type) => type === 'null' || type === 'undefined')) return anyType;
  return types.join(' | ');
}

export type GlobalDeclarationsResult =
  | { kind: 'declarations'; filePath: string; text: string; declarations: GlobalDeclaration[] }
  | { kind: 'nothing' }
  /** A file sits at that path that a rewrite would lose content from. */
  | { kind: 'foreign'; filePath: string };

/**
 * Builds the declaration file from the properties this run found assigned plus
 * the ones an earlier run declared.
 *
 * Entries persist across runs. A property that is declared no longer produces
 * the error that made it visible, and the code that assigned it may since have
 * been deleted, so nothing here can tell a stale entry from a live one. A
 * stale entry that something else has come to declare is a duplicate
 * declaration error naming this file, which is the visible failure; dropping
 * entries on a guess would be the silent one.
 *
 * A previous type this would only overwrite with the any alias is kept: that
 * is a type somebody narrowed by hand, and widening it back would undo the
 * edit on every run.
 */
export function buildGlobalDeclarations(
  evidence: GlobalAssignmentEvidence,
  rootDir: string,
  { anyAlias }: { anyAlias?: string } = {},
): GlobalDeclarationsResult {
  const filePath = globalDeclarationsPath(rootDir);
  let existingText: string | undefined;
  try {
    existingText = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // No declaration file yet.
  }
  const previous = existingText === undefined ? [] : parseGlobalDeclarations(existingText);
  if (previous === null) return { kind: 'foreign', filePath };

  const anyType = anyAlias ?? 'any';
  const merged = new Map<string, GlobalDeclaration>();
  previous.forEach((declaration) => merged.set(declaration.name, declaration));
  evidence.properties.forEach((property) => {
    const earlier = merged.get(property.name);
    const derived = declaredType(property, anyType);
    merged.set(property.name, {
      name: property.name,
      target: earlier?.target === 'globalThis' ? 'globalThis' : property.target,
      type: earlier && derived === anyType ? earlier.type : derived,
    });
  });

  const declarations = [...merged.values()].sort(byName);
  if (declarations.length === 0) return { kind: 'nothing' };
  return {
    kind: 'declarations',
    filePath,
    text: renderGlobalDeclarations(declarations),
    declarations,
  };
}

export interface GlobalDeclarationsReport {
  /** The file that was written, when one was. */
  filePath?: string;
  declarations: GlobalDeclaration[];
  /** Where each declared property is assigned. */
  properties: { name: string; assignments: number; fileCount: number }[];
  /** A file at the generated path that ts-migrate did not write. */
  foreignFile?: string;
}

export interface GlobalDeclarationsCollector {
  /** Records the global assignments in each file. */
  plugin: Plugin<unknown>;
  /**
   * Writes what `plugin` found. Add it to the pipeline directly after that
   * plugin, and both before add-conversions: the evidence is complete once a
   * pass ends, and the declarations have to reach the program before
   * add-conversions casts the sites they resolve.
   */
  declarationsPlugin: Plugin<unknown>;
  summarize(): GlobalDeclarationsReport;
}

/**
 * Creates the pair of plugins that turn the project's `window.x = ...` and
 * `global.x = ...` assignments into one generated `declare global` block. The
 * evidence accumulates across files here, since a plugin only ever sees one
 * file and a global belongs to the project.
 */
export function createGlobalDeclarations(
  options: { anyAlias?: string } = {},
): GlobalDeclarationsCollector {
  const evidence = createGlobalAssignmentEvidence();
  const visited = new Set<string>();

  const plugin: Plugin<unknown> = {
    name: 'collect-global-assignments',
    mutationsPreserveTypes: true,
    run({ fileName, sourceFile, getLanguageService }) {
      if (visited.has(fileName)) return undefined;
      visited.add(fileName);
      collectGlobalAssignments({
        evidence,
        sourceFile,
        checker: getLanguageService().getProgram()?.getTypeChecker(),
      });
      return undefined;
    },
  };

  let result: GlobalDeclarationsResult = { kind: 'nothing' };
  let declarationsRun = false;
  const declarationsPlugin: Plugin<unknown> = {
    name: 'declare-globals',
    mutationsPreserveTypes: true,
    run({ rootDir, addGeneratedFile, reportFileNotice }) {
      // One file's worth of work for the whole run: the evidence covers every
      // file already, and writing the file again per file would invalidate the
      // program each time.
      if (declarationsRun) return undefined;
      declarationsRun = true;
      if (!addGeneratedFile) return undefined;

      result = buildGlobalDeclarations(evidence, rootDir, options);
      if (result.kind === 'declarations') {
        addGeneratedFile(result.filePath, result.text);
      } else if (result.kind === 'foreign') {
        reportFileNotice?.({
          reason:
            `${GLOBAL_DECLARATIONS_FILE} holds declarations ts-migrate did not write, so the ` +
            'globals this run found were not declared',
          hint:
            'That file is rewritten in full from its own declarations on every run. Move ' +
            'hand-written declarations into a file of your own so ts-migrate can manage this one.',
          recovered: true,
        });
      }
      return undefined;
    },
  };

  return {
    plugin,
    declarationsPlugin,
    summarize: () => ({
      filePath: result.kind === 'declarations' ? result.filePath : undefined,
      declarations: result.kind === 'declarations' ? result.declarations : [],
      properties: [...evidence.properties.values()].map((property) => ({
        name: property.name,
        assignments: property.assignments,
        fileCount: property.files.size,
      })),
      foreignFile: result.kind === 'foreign' ? result.filePath : undefined,
    }),
  };
}
