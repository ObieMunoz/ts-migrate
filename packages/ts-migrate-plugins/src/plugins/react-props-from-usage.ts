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
// Returns undefined when the symbol is declared in the same file or has no
// clear single-module home (e.g. intrinsic / anonymous types).
function resolveSymbolImport(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
  componentFileName: string,
): NamedImport | undefined {
  if (!sym.declarations?.length) return undefined;
  const namedImport = sym.getName();
  if (!namedImport || namedImport.startsWith('__')) return undefined;

  const fqn = checker.getFullyQualifiedName(sym);
  // External modules have FQN of the form `"module-or-path".SymbolName`
  const moduleMatch = /^"(.+)"\.[^.]+$/.exec(fqn);
  if (!moduleMatch) return undefined; // same-file symbol — no import needed

  const moduleStr = moduleMatch[1];

  // Bare package name (no leading . or /): use as-is.
  if (!moduleStr.startsWith('.') && !moduleStr.startsWith('/')) {
    return { namedImport, moduleSpecifier: moduleStr };
  }

  // Local file: compute a relative specifier from the component file.
  const rel = path
    .relative(path.dirname(componentFileName), moduleStr)
    .replace(/\.d\.ts$/, '')
    .replace(/\.(tsx?|jsx?)$/, '');
  const moduleSpecifier = rel.startsWith('.') ? rel : `./${rel}`;
  return { namedImport, moduleSpecifier };
}

// Recursively collect all importable symbols from a ts.Type, including its
// type arguments, union/intersection members, etc.
function collectImportSpecs(
  type: ts.Type,
  checker: ts.TypeChecker,
  componentFileName: string,
  seen: Set<ts.Symbol>,
  out: NamedImport[],
): void {
  // Always prefer the alias symbol: if the type is `ButtonSize = 'sm' | 'md'`,
  // we want `ButtonSize` — not a recursion into the string literal members.
  if (type.aliasSymbol) {
    if (!seen.has(type.aliasSymbol)) {
      seen.add(type.aliasSymbol);
      const imp = resolveSymbolImport(type.aliasSymbol, checker, componentFileName);
      if (imp) out.push(imp);
    }
    // Recurse into alias type arguments (e.g. Map<K, V> → also import K and V).
    if (type.aliasTypeArguments) {
      for (const arg of type.aliasTypeArguments) {
        collectImportSpecs(arg, checker, componentFileName, seen, out);
      }
    }
    return;
  }

  // Recurse into union / intersection members.
  if (type.isUnion() || type.isIntersection()) {
    for (const part of type.types) {
      collectImportSpecs(part, checker, componentFileName, seen, out);
    }
    return;
  }

  // Plain reference type: collect the symbol.
  const sym = type.symbol;
  if (sym && !seen.has(sym)) {
    seen.add(sym);
    const imp = resolveSymbolImport(sym, checker, componentFileName);
    if (imp) out.push(imp);
  }

  // Recurse into type arguments (generic instantiations).
  const typeArgs = (type as ts.TypeReference).typeArguments;
  if (typeArgs) {
    for (const arg of typeArgs) {
      collectImportSpecs(arg, checker, componentFileName, seen, out);
    }
  }
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

function findNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (pos < node.getStart(sourceFile) || pos >= node.getEnd()) return undefined;
    return ts.forEachChild(node, find) ?? node;
  }
  return find(sourceFile);
}

// Split a type string on `sep` only at depth 0 (not inside < > ( ) [ ] { }).
function splitTopLevel(str: string, sep: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth === 0 && str.startsWith(sep, i)) {
      result.push(current.trim());
      current = '';
      i += sep.length - 1;
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Convert a type string (as produced by checker.typeToString or our own
// literal-union builder) to a ts.TypeNode using ts.factory calls only, so
// the resulting nodes have no source positions and print cleanly.
function buildTypeNode(typeStr: string, anyAlias?: string): ts.TypeNode {
  typeStr = typeStr.trim();

  // Union type: split at top-level ' | '
  const unionParts = splitTopLevel(typeStr, ' | ');
  if (unionParts.length > 1) {
    return ts.factory.createUnionTypeNode(
      unionParts.map((p) => buildTypeNode(p, anyAlias)),
    );
  }

  // Double-quoted string literal
  if (typeStr.startsWith('"') && typeStr.endsWith('"') && typeStr.length >= 2) {
    return ts.factory.createLiteralTypeNode(
      ts.factory.createStringLiteral(typeStr.slice(1, -1)),
    );
  }
  // Single-quoted string literal
  if (typeStr.startsWith("'") && typeStr.endsWith("'") && typeStr.length >= 2) {
    return ts.factory.createLiteralTypeNode(
      ts.factory.createStringLiteral(typeStr.slice(1, -1)),
    );
  }

  // Numeric literal (including negative)
  if (/^-?\d+(\.\d+)?$/.test(typeStr)) {
    const numVal = Number(typeStr);
    const literal =
      numVal < 0
        ? (ts.factory.createPrefixUnaryExpression(
            ts.SyntaxKind.MinusToken,
            ts.factory.createNumericLiteral(String(-numVal)),
          ) as unknown as ts.LiteralExpression)
        : ts.factory.createNumericLiteral(typeStr);
    return ts.factory.createLiteralTypeNode(literal);
  }

  // Boolean literals
  if (typeStr === 'true') return ts.factory.createLiteralTypeNode(ts.factory.createTrue());
  if (typeStr === 'false') return ts.factory.createLiteralTypeNode(ts.factory.createFalse());

  // Array type: T[]
  if (typeStr.endsWith('[]')) {
    return ts.factory.createArrayTypeNode(buildTypeNode(typeStr.slice(0, -2), anyAlias));
  }

  // Generic type reference: Name<A, B>
  const genericMatch = /^([A-Za-z_$][A-Za-z0-9_$.]*)<(.+)>$/.exec(typeStr);
  if (genericMatch) {
    const [, name, args] = genericMatch;
    const typeArgs = splitTopLevel(args, ', ').map((a) => buildTypeNode(a, anyAlias));
    return ts.factory.createTypeReferenceNode(name, typeArgs);
  }

  // Keyword types
  switch (typeStr) {
    case 'string':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    case 'number':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    case 'boolean':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
    case 'any':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    case 'void':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
    case 'never':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
    case 'unknown':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);
    case 'null':
      return ts.factory.createLiteralTypeNode(ts.factory.createNull());
    case 'undefined':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword);
    case 'object':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword);
    case 'symbol':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.SymbolKeyword);
    case 'bigint':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword);
    default:
      break;
  }

  // anyAlias reference
  if (anyAlias && typeStr === anyAlias) {
    return ts.factory.createTypeReferenceNode(anyAlias, undefined);
  }

  // Qualified / dotted name (e.g. React.ReactNode, JSX.Element)
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(typeStr)) {
    const parts = typeStr.split('.');
    let entityName: ts.EntityName = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      entityName = ts.factory.createQualifiedName(
        entityName,
        ts.factory.createIdentifier(parts[i]),
      );
    }
    return ts.factory.createTypeReferenceNode(entityName, undefined);
  }

  // Fallback: emit anyAlias / any
  return anyAlias
    ? ts.factory.createTypeReferenceNode(anyAlias, undefined)
    : ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}

// Reduce a list of observed type strings to a single canonical type string.
// All literals are widened to their base type.
function widenTypes(observedTypes: string[], anyAlias?: string): string {
  if (observedTypes.length === 0) return anyAlias ?? 'any';
  const anyType = anyAlias ?? 'any';

  const unique = [...new Set(observedTypes)];

  if (unique.some((t) => t === 'any' || (anyAlias != null && t === anyAlias))) {
    return anyType;
  }

  const isStrLit = (t: string) => /^["'].*["']$/.test(t);
  const isNumLit = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
  const isBoolLit = (t: string) => t === 'true' || t === 'false';

  // Widen each observed type to its base type, then union the distinct bases.
  const baseTypes = new Set<string>();
  for (const t of unique) {
    if (isStrLit(t)) baseTypes.add('string');
    else if (isNumLit(t)) baseTypes.add('number');
    else if (isBoolLit(t)) baseTypes.add('boolean');
    else baseTypes.add(t);
  }

  const arr = [...baseTypes];
  return arr.length === 1 ? arr[0] : arr.join(' | ');
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
      if (!needsPropsType(heritageType)) continue;
      if (!classDeclaration.name) continue;

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
      const classNamePos = classDeclaration.name.getStart(sourceFile);
      let totalCallSites = 0;
      let shouldSkip = false;

      const referencedSymbols =
        languageService.findReferences(fileName, classNamePos) ?? [];

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
              tsType = checker.getTypeAtLocation(attr.initializer.expression);
              typeStr = checker.typeToString(tsType);
              // Normalise the import() notation TypeScript sometimes emits
              // (e.g. `import("@reduxjs/toolkit").AsyncThunk`) to the bare name.
              const importNotation = /^import\("([^"]+)"\)\.([^.]+)$/.exec(typeStr);
              if (importNotation) {
                typeStr = importNotation[2];
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

        // Collect imports for any non-primitive, non-keyword types that survive widening.
        for (const tsType of info.observedTsTypes) {
          if (tsType != null) {
            collectImportSpecs(tsType, checker, fileName, importSeen, neededImports);
          }
        }

        members.push(
          ts.factory.createPropertySignature(
            undefined,
            propName,
            isOptional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
            buildTypeNode(finalTypeStr, anyAlias),
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
