import path from 'path';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import {
  isReactClassComponent,
  getReactComponentHeritageType,
  getNumComponentsInSourceFile,
} from './utils/react';
import { collectIdentifiers } from './utils/identifiers';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { updateImports, NamedImport } from './utils/imports';
import { collectImportSpecs, resolveSymbolImport } from './utils/importSpecs';
import { buildTypeNode, widenTypes, typeStrDegradesToAny } from './utils/typeStrings';
import {
  AnyAliasOptions,
  AnyFunctionAliasOptions,
  Properties,
  anyAliasProperty,
  anyFunctionAliasProperty,
  createValidate,
} from '../utils/validateOptions';

type Options = {
  includeChildren?: boolean;
  defaultOptional?: boolean;
  skipOnSpread?: boolean;
  useThisPropsUsage?: boolean;
} & AnyAliasOptions &
  AnyFunctionAliasOptions;

const optionProperties: Properties = {
  ...anyAliasProperty,
  ...anyFunctionAliasProperty,
  includeChildren: { type: 'boolean' },
  defaultOptional: { type: 'boolean' },
  skipOnSpread: { type: 'boolean' },
  useThisPropsUsage: { type: 'boolean' },
};

// Evidence for a single prop gathered across all call sites and this.props usage.
interface PropInfo {
  // Observed TypeScript type strings (e.g. '"sm"', 'number', 'boolean').
  observedTypes: string[];
  // Parallel array: the raw ts.Type for each entry in observedTypes, or null
  // when the type was synthesised (string literal, boolean shorthand, etc.).
  observedTsTypes: (ts.Type | null)[];
  // Number of call sites where this prop appeared as an explicit attribute.
  presentCount: number;
  // Whether optional-access patterns (?.  / default destructuring) were seen
  // for this prop in the class body.
  optionalHint: boolean;
  // True when the prop was only found via this.props analysis (no call-site
  // evidence at all).
  thisPropsOnly: boolean;
}

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------

// Given a symbol, try to find the module it should be imported from.
// Scan a source file's named-import declarations for a given identifier.
// Returns a NamedImport spec, resolving any relative paths relative to componentFileName.
function findNamedImportInSourceFile(
  namedImport: string,
  sourceFile: ts.SourceFile,
  componentFileName: string,
): NamedImport | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleStr = stmt.moduleSpecifier.text;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text === namedImport) {
        if (!moduleStr.startsWith('.') && !moduleStr.startsWith('/')) {
          return { namedImport, moduleSpecifier: moduleStr };
        }
        // Relative: resolve from the call-site directory then re-relativise to component.
        const abs = path.resolve(path.dirname(sourceFile.fileName), moduleStr);
        const rel = path.relative(path.dirname(componentFileName), abs);
        const moduleSpecifier = rel.startsWith('.') ? rel : `./${rel}`;
        return { namedImport, moduleSpecifier };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function needsPropsType(heritageType: ts.ExpressionWithTypeArguments): boolean {
  const args = heritageType.typeArguments;
  if (!args || args.length === 0) return true;
  const propsArg = args[0];
  if (propsArg.kind === ts.SyntaxKind.AnyKeyword) return true;
  if (ts.isTypeLiteralNode(propsArg) && propsArg.members.length === 0) return true;
  if (propsArg.kind === ts.SyntaxKind.ObjectKeyword) return true;
  return false;
}

// Returns the TypeAliasDeclaration for the props type argument when it is a
// same-file named alias whose type literal has at least one `any`-typed
// property — i.e. it can be patched with call-site evidence.
function findPatchablePropsAlias(
  heritageType: ts.ExpressionWithTypeArguments,
  sourceFile: ts.SourceFile,
): ts.TypeAliasDeclaration | undefined {
  const args = heritageType.typeArguments;
  if (!args || args.length === 0) return undefined;
  const propsArg = args[0];
  if (!ts.isTypeReferenceNode(propsArg)) return undefined;
  if (!ts.isIdentifier(propsArg.typeName)) return undefined;
  const refName = propsArg.typeName.text;

  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue;
    if (stmt.name.text !== refName) continue;
    if (!ts.isTypeLiteralNode(stmt.type)) continue;
    const hasAnyMember = stmt.type.members.some(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) &&
        m.type != null &&
        m.type.kind === ts.SyntaxKind.AnyKeyword,
    );
    if (hasAnyMember) return stmt;
  }
  return undefined;
}

function collectThisPropsUsage(
  classDeclaration: ts.ClassDeclaration,
): Map<string, { optionalHint: boolean }> {
  const result = new Map<string, { optionalHint: boolean }>();

  function markProp(name: string, optional: boolean) {
    const existing = result.get(name);
    if (existing) {
      if (optional) existing.optionalHint = true;
    } else {
      result.set(name, { optionalHint: optional });
    }
  }

  function visit(node: ts.Node) {
    // this.props.x  or  this.props?.x  (element-access covered separately)
    if (ts.isPropertyAccessExpression(node)) {
      const inner = node.expression;
      if (
        ts.isPropertyAccessExpression(inner) &&
        inner.expression.kind === ts.SyntaxKind.ThisKeyword &&
        inner.name.text === 'props'
      ) {
        const optional = node.questionDotToken != null;
        markProp(node.name.text, optional);
      }
    }

    // const { a, b = defaultVal } = this.props
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.initializer.name.text === 'props'
    ) {
      for (const element of node.name.elements) {
        const propName = element.propertyName
          ? ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : undefined
          : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
        if (propName) {
          markProp(propName, element.initializer != null);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(classDeclaration, visit);
  return result;
}

// immer's Draft helpers (Draft / WritableDraft / WritableNonArrayDraft /
// WritableArrayDraft) are structurally identical to the type they wrap but are
// internal aliases — WritableNonArrayDraft and WritableArrayDraft are not even
// exported from immer. TypeScript surfaces them at call sites when a value has
// flowed through a redux-toolkit reducer (state is `Draft<T>`), so e.g.
// `store.usage` (RootState['usage']) reports as `WritableNonArrayDraft<UsageState>`.
// Emitting that verbatim produces an unresolvable type name, so unwrap the
// alias to its single underlying type argument.
const IMMER_DRAFT_ALIASES = new Set([
  'Draft',
  'WritableDraft',
  'WritableNonArrayDraft',
  'WritableArrayDraft',
]);

function isDeclaredInImmer(sym: ts.Symbol): boolean {
  return (sym.declarations ?? []).some((decl) =>
    decl.getSourceFile().fileName.includes('/immer/'),
  );
}

function unwrapImmerDraft(type: ts.Type): ts.Type {
  const aliasSymbol = type.aliasSymbol;
  if (
    aliasSymbol &&
    IMMER_DRAFT_ALIASES.has(aliasSymbol.getName()) &&
    isDeclaredInImmer(aliasSymbol) &&
    type.aliasTypeArguments?.length === 1
  ) {
    return unwrapImmerDraft(type.aliasTypeArguments[0]);
  }
  return type;
}

function findNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (pos < node.getStart(sourceFile) || pos >= node.getEnd()) return undefined;
    return ts.forEachChild(node, find) ?? node;
  }
  return find(sourceFile);
}

// When a call-site value's type would degrade to `any` (e.g. an action creator
// with a large function signature), but that type is exactly the type of a
// named, exported value, we can express the prop as `typeof <value>` — which is
// both accurate and imports cleanly. Returns the import spec for that value, or
// undefined when no such value symbol exists (e.g. type-only aliases like
// `Search`, anonymous functions, or union/intrinsic types).
function resolveTypeofValueImport(
  type: ts.Type,
  checker: ts.TypeChecker,
  componentFileName: string,
): NamedImport | undefined {
  const sym = type.aliasSymbol ?? type.symbol;
  if (!sym) return undefined;
  // `typeof` is only valid on something with a value meaning; a type-only alias
  // (e.g. `type Search = …`) must keep its own name, not become `typeof Search`.
  if (!(sym.flags & ts.SymbolFlags.Value)) return undefined;
  const name = sym.getName();
  if (!name || name.startsWith('__')) return undefined;
  // Default exports have the internal symbol name `default`, which cannot be
  // referenced via a named import (`import { default }` is invalid) nor used in
  // `typeof default`. Supporting default imports here would also collide when
  // multiple call sites pass different default exports to the same prop, so we
  // bail and let the prop fall back to `any`.
  if (name === 'default') return undefined;

  const imp = resolveSymbolImport(sym, checker, componentFileName);
  if (!imp || imp.namedImport !== name) return undefined;

  // Verify the value is actually exported from its declaring module so the
  // emitted import resolves. resolveSymbolImport already checks this for
  // node_modules packages; extend the guard to local files so we never
  // reference a non-exported local binding.
  const declFile = sym.declarations?.[0]?.getSourceFile();
  if (declFile) {
    const moduleSymbol = checker.getSymbolAtLocation(declFile);
    if (moduleSymbol) {
      const exports = checker.getExportsOfModule(moduleSymbol);
      if (!exports.some((exp) => exp.getName() === name)) return undefined;
    }
  }

  return imp;
}

// ---------------------------------------------------------------------------
// Call-site evidence collection (shared between "generate" and "patch" paths)
// ---------------------------------------------------------------------------

interface CallSiteResult {
  propMap: Map<string, PropInfo>;
  totalCallSites: number;
  shouldSkip: boolean;
  neededImports: NamedImport[];
}

function collectCallSiteProps(
  classDeclaration: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  fileName: string,
  languageService: ts.LanguageService,
  checker: ts.TypeChecker,
  options: {
    anyAlias?: string;
    includeChildren: boolean;
    skipOnSpread: boolean;
  },
  program: ts.Program,
): CallSiteResult {
  const { anyAlias, includeChildren, skipOnSpread } = options;
  const propMap = new Map<string, PropInfo>();
  const neededImports: NamedImport[] = [];
  let totalCallSites = 0;
  let shouldSkip = false;

  const classNamePos = classDeclaration.name!.getStart(sourceFile);
  const referencedSymbols = languageService.findReferences(fileName, classNamePos) ?? [];

  outer: for (const referencedSymbol of referencedSymbols) {
    for (const ref of referencedSymbol.references) {
      if (ref.isDefinition) continue;

      const refSourceFile = program.getSourceFile(ref.fileName);
      if (!refSourceFile) continue;

      const refNode = findNodeAtPosition(refSourceFile, ref.textSpan.start);
      if (!refNode || !ts.isIdentifier(refNode)) continue;

      const parent = refNode.parent;
      let jsxElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined;

      if (ts.isJsxOpeningElement(parent) && parent.tagName === refNode) {
        jsxElement = parent;
      } else if (ts.isJsxSelfClosingElement(parent) && parent.tagName === refNode) {
        jsxElement = parent;
      }

      if (!jsxElement) continue;

      // Check for spread attributes before counting this as a call site.
      for (const attr of jsxElement.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr) && skipOnSpread) {
          shouldSkip = true;
          break outer;
        }
      }

      totalCallSites++;

      // Check children (only for opening elements, not self-closing).
      if (
        includeChildren &&
        ts.isJsxOpeningElement(jsxElement) &&
        ts.isJsxElement(jsxElement.parent) &&
        jsxElement.parent.children.length > 0
      ) {
        const info = propMap.get('children');
        if (info) {
          info.presentCount++;
          info.thisPropsOnly = false;
        } else {
          propMap.set('children', {
            observedTypes: ['React.ReactNode'],
            observedTsTypes: [null],
            presentCount: 1,
            optionalHint: true,
            thisPropsOnly: false,
          });
        }
      }

      // Collect explicit JSX attributes.
      for (const attr of jsxElement.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const propName = ts.isIdentifier(attr.name) ? attr.name.text : undefined;
        if (!propName || propName === 'key' || propName === 'ref') continue;

        let typeStr: string;
        let tsType: ts.Type | null = null;
        if (!attr.initializer) {
          // Boolean shorthand: <Foo disabled />
          typeStr = 'boolean';
        } else if (ts.isStringLiteral(attr.initializer)) {
          typeStr = `"${attr.initializer.text}"`;
        } else if (
          ts.isJsxExpression(attr.initializer) &&
          attr.initializer.expression != null
        ) {
          tsType = unwrapImmerDraft(checker.getTypeAtLocation(attr.initializer.expression));
          typeStr = checker.typeToString(tsType);
          // Strip any import() notation TypeScript may emit for types from
          // external modules not imported in the component file.
          const importPrefix = /^import\("[^"]+"\)\./.exec(typeStr);
          if (importPrefix) {
            typeStr = typeStr.slice(importPrefix[0].length);
          }
          if (typeStrDegradesToAny(typeStr)) {
            // The type can't be reconstructed as anything better than `any`
            // (typically a function type such as an action creator). If it is
            // exactly the type of a named, exported value, express it as
            // `typeof <value>` and import that value instead of emitting `any`.
            const typeofImport = resolveTypeofValueImport(tsType, checker, fileName);
            if (typeofImport) {
              typeStr = `typeof ${typeofImport.namedImport}`;
              neededImports.push(typeofImport);
              // The import is handled here; don't let collectImportSpecs run on
              // the raw function type later (it would re-add the same import).
              tsType = null;
            }
          } else {
            // Fallback: scan the call-site's own import declarations for the
            // leading identifier of typeStr. This catches types that are
            // re-exported through a barrel and have a bare FQN (no module
            // prefix), so resolveSymbolImport / collectImportSpecs cannot
            // determine which specifier to import from — but the call site
            // already has the correct import and we can mirror it.
            const baseTypeName = /^([A-Z][A-Za-z0-9_$]*)/.exec(typeStr)?.[1];
            if (baseTypeName) {
              const callSiteImport = findNamedImportInSourceFile(
                baseTypeName,
                refSourceFile,
                fileName,
              );
              if (callSiteImport) neededImports.push(callSiteImport);
            }
          }
        } else {
          typeStr = anyAlias ?? 'any';
        }

        const existing = propMap.get(propName);
        if (existing) {
          existing.observedTypes.push(typeStr);
          existing.observedTsTypes.push(tsType);
          existing.presentCount++;
          existing.thisPropsOnly = false;
        } else {
          propMap.set(propName, {
            observedTypes: [typeStr],
            observedTsTypes: [tsType],
            presentCount: 1,
            optionalHint: false,
            thisPropsOnly: false,
          });
        }
      }
    }
  }

  return { propMap, totalCallSites, shouldSkip, neededImports };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const reactPropsFromUsagePlugin: Plugin<Options> = {
  name: 'react-props-from-usage',

  // Cross-file: do not run files in parallel, and edits do affect types that
  // other files depend on.
  independentFiles: false,

  run({ fileName, sourceFile, options, getLanguageService }) {
    if (!fileName.endsWith('.tsx')) return undefined;

    const {
      anyAlias,
      includeChildren = true,
      defaultOptional = false,
      skipOnSpread = true,
      useThisPropsUsage = true,
    } = options;

    const languageService = getLanguageService();
    const program = languageService.getProgram();
    if (!program) return undefined;
    const checker = program.getTypeChecker();

    const reactClassDeclarations = sourceFile.statements
      .filter(ts.isClassDeclaration)
      .filter(isReactClassComponent);

    if (reactClassDeclarations.length === 0) return undefined;

    const numComponentsInFile = getNumComponentsInSourceFile(sourceFile);
    // Track used identifiers so we can guarantee unique type-alias names.
    const usedIdentifiers = collectIdentifiers(sourceFile);

    const updates: SourceTextUpdate[] = [];
    const printer = ts.createPrinter();
    // Collects import specs for all type references used across all emitted Props types.
    const neededImports: NamedImport[] = [];
    const importSeen = new Set<ts.Symbol>();

    for (const classDeclaration of reactClassDeclarations) {
      const heritageType = getReactComponentHeritageType(classDeclaration);
      if (!heritageType) continue;
      if (!classDeclaration.name) continue;

      // --- Patch path: existing named Props alias with `any` members ---
      const patchableAlias = !needsPropsType(heritageType)
        ? findPatchablePropsAlias(heritageType, sourceFile)
        : undefined;

      if (patchableAlias != null) {
        const { propMap, shouldSkip, neededImports: callNeededImports } = collectCallSiteProps(
          classDeclaration,
          sourceFile,
          fileName,
          languageService,
          checker,
          { anyAlias, includeChildren, skipOnSpread },
          program,
        );

        if (shouldSkip) continue;

        const typeLiteral = patchableAlias.type as ts.TypeLiteralNode;
        let patched = false;
        for (const member of typeLiteral.members) {
          if (!ts.isPropertySignature(member)) continue;
          if (!member.type || member.type.kind !== ts.SyntaxKind.AnyKeyword) continue;
          if (!ts.isIdentifier(member.name)) continue;
          const propName = member.name.text;
          const info = propMap.get(propName);
          if (!info || info.observedTypes.length === 0) continue;
          const finalTypeStr = widenTypes(info.observedTypes, anyAlias);
          if (finalTypeStr === 'any' || finalTypeStr === (anyAlias ?? 'any')) continue;

          // Reconstruct the type via the factory rather than splicing the raw
          // `typeToString` output as text: for large types `typeToString`
          // truncates with `...`/`... N more ...`/`<...>` markers that are not
          // valid syntax. buildTypeNode falls back to `any` for anything it
          // cannot parse, so the emitted text is always syntactically valid
          // (matching the generate path below). Skip when it degrades to `any`,
          // which leaves the member as its existing `any`.
          const typeNode = buildTypeNode(finalTypeStr, anyAlias);
          const printedType = printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile);
          if (printedType === 'any' || printedType === (anyAlias ?? 'any')) continue;

          // Collect imports for surviving non-primitive types.
          for (const tsType of info.observedTsTypes) {
            if (tsType != null) {
              collectImportSpecs(tsType, checker, fileName, importSeen, neededImports);
            }
          }

          updates.push({
            kind: 'replace',
            index: member.type.getStart(sourceFile),
            length: member.type.getWidth(sourceFile),
            text: printedType,
          });
          patched = true;
        }
        // callNeededImports holds `typeof`-import specs for the entire call-site
        // scan (not per-member), so push them once after the member loop.
        if (patched) neededImports.push(...callNeededImports);
        if (!patched) continue;
        continue;
      }

      if (!needsPropsType(heritageType)) continue;

      const componentName = classDeclaration.name.text;

      // Determine a unique props type name.
      let baseName = numComponentsInFile > 1 ? `${componentName}Props` : 'Props';
      if (usedIdentifiers.has(baseName)) {
        let i = 1;
        while (usedIdentifiers.has(baseName + i)) i++;
        baseName = baseName + i;
      }
      const propsTypeName = baseName;
      usedIdentifiers.add(propsTypeName);

      // --- Evidence collection ---
      const propMap = new Map<string, PropInfo>();

      // 2a. this.props usage inside the class body.
      if (useThisPropsUsage) {
        const thisProps = collectThisPropsUsage(classDeclaration);
        for (const [name, { optionalHint }] of thisProps) {
          propMap.set(name, {
            observedTypes: [],
            observedTsTypes: [],
            presentCount: 0,
            optionalHint,
            thisPropsOnly: true,
          });
        }
      }

      // 2b. Call-site analysis via findReferences.
      const {
        propMap: callSitePropMap,
        totalCallSites,
        shouldSkip,
        neededImports: callNeededImports,
      } = collectCallSiteProps(
        classDeclaration,
        sourceFile,
        fileName,
        languageService,
        checker,
        { anyAlias, includeChildren, skipOnSpread },
        program,
      );
      neededImports.push(...callNeededImports);

      // Merge call-site evidence into the propMap (seeded from this.props).
      for (const [propName, info] of callSitePropMap) {
        const existing = propMap.get(propName);
        if (existing) {
          existing.observedTypes.push(...info.observedTypes);
          existing.observedTsTypes.push(...info.observedTsTypes);
          existing.presentCount += info.presentCount;
          if (!info.thisPropsOnly) existing.thisPropsOnly = false;
        } else {
          propMap.set(propName, info);
        }
      }

      if (shouldSkip) continue;
      if (propMap.size === 0) continue;

      // --- Merge evidence into property signatures ---
      const members: ts.PropertySignature[] = [];

      for (const [propName, info] of propMap) {
        // children is always React.ReactNode and optional.
        if (propName === 'children') {
          if (!includeChildren) continue;
          const childrenTypeNode = ts.factory.createTypeReferenceNode(
            ts.factory.createQualifiedName(
              ts.factory.createIdentifier('React'),
              ts.factory.createIdentifier('ReactNode'),
            ),
            undefined,
          );
          members.push(
            ts.factory.createPropertySignature(
              undefined,
              'children',
              ts.factory.createToken(ts.SyntaxKind.QuestionToken),
              childrenTypeNode,
            ),
          );
          continue;
        }

        // Determine optionality.
        let isOptional: boolean;
        if (defaultOptional) {
          isOptional = true;
        } else if (info.thisPropsOnly || totalCallSites === 0) {
          // Only body evidence — treat as required unless optional-access hints.
          isOptional = info.optionalHint;
        } else {
          // Present at fewer call sites than the total → optional.
          isOptional = info.presentCount < totalCallSites || info.optionalHint;
        }

        // Determine type.
        const finalTypeStr =
          info.observedTypes.length > 0
            ? widenTypes(info.observedTypes, anyAlias)
            : (anyAlias ?? 'any');

        const typeNode = buildTypeNode(finalTypeStr, anyAlias);
        const printedType = printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile);
        const degradesToAny =
          printedType === 'any' || printedType === (anyAlias ?? 'any');

        // Collect imports for the type's referenced symbols — but only when the
        // emitted type actually survives. Emitting `any` while importing the
        // type's symbols would leave dangling, unused imports.
        if (!degradesToAny) {
          for (const tsType of info.observedTsTypes) {
            if (tsType != null) {
              collectImportSpecs(tsType, checker, fileName, importSeen, neededImports);
            }
          }
        }

        members.push(
          ts.factory.createPropertySignature(
            undefined,
            propName,
            isOptional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
            typeNode,
          ),
        );
      }

      // --- Emit type alias + heritage update ---
      const propsTypeAlias = ts.factory.createTypeAliasDeclaration(
        undefined,
        propsTypeName,
        undefined,
        ts.factory.createTypeLiteralNode(members),
      );

      updates.push({
        kind: 'insert',
        index: classDeclaration.pos,
        text: `\n\n${printer.printNode(ts.EmitHint.Unspecified, propsTypeAlias, sourceFile)}`,
      });

      // Replace the heritage type to add the props type argument.
      const existingArgs = heritageType.typeArguments ?? [];
      const newArgs: ts.TypeNode[] = [
        ts.factory.createTypeReferenceNode(propsTypeName, undefined),
        ...existingArgs.slice(1),
      ];

      updates.push({
        kind: 'replace',
        index: heritageType.pos,
        length: heritageType.end - heritageType.pos,
        text: ` ${printer.printNode(
          ts.EmitHint.Unspecified,
          ts.factory.updateExpressionWithTypeArguments(
            heritageType,
            heritageType.expression,
            newArgs,
          ),
          sourceFile,
        )}`,
      });
    }

    if (updates.length === 0) return undefined;

    // --- Apply content edits, then add missing import statements ---
    const updatedText = updateSourceText(sourceFile.text, updates);
    const updatedSourceFile = ts.createSourceFile(
      fileName,
      updatedText,
      sourceFile.languageVersion,
    );
    const importUpdates = updateImports(updatedSourceFile, neededImports, []);
    return importUpdates.length > 0
      ? updateSourceText(updatedText, importUpdates)
      : updatedText;
  },

  validate: createValidate<Options>(optionProperties),
};

export default reactPropsFromUsagePlugin;
