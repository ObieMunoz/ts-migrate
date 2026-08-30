import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import getTokenAtPosition from './utils/token-pos';
import { jestMockType } from './utils/mockTypes';
import { anyTypeNode } from './utils/anyTypes';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import UpdateTracker from './utils/update';

type Options = AnyAliasOptions;

const supportedDiagnostics = new Set([
  // TS2339: Property '{0}' does not exist on type '{1}'.
  2339,
  // TS2571: Object is of type 'unknown'.
  2571,
  // TS7015: Element implicitly has an 'any' type because index expression is not of type 'number'.
  7015,
  // TS7017: Element implicitly has an 'any' type because type '{0}' has no index signature.
  7017,
  // TS7053: Element implicitly has an 'any' type because expression of type '{0}' can't be used
  // to index type '{1}'.
  7053,
  // TS18046: '{0}' is of type 'unknown'. (TS 4.4+ successor to TS2571.)
  18046,
]);

const addConversionsPlugin: Plugin<Options> = {
  name: 'add-conversions',

  run({ fileName, sourceFile, options, getLanguageService }) {
    const languageService = getLanguageService();

    const diags = languageService
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diag) => supportedDiagnostics.has(diag.code));

    const checker = languageService.getProgram()?.getTypeChecker();
    const updates = new UpdateTracker(sourceFile);
    ts.transform(sourceFile, [addConversionsTransformerFactory(updates, diags, options, checker)]);
    return updates.apply();
  },

  validate: validateAnyAliasOptions,
};

export default addConversionsPlugin;

const addConversionsTransformerFactory =
  (
    updates: UpdateTracker,
    diags: ts.DiagnosticWithLocation[],
    { anyAlias }: Options,
    checker: ts.TypeChecker | undefined,
  ) =>
  (context: ts.TransformationContext) => {
    const { factory } = context;
    const anyType = anyTypeNode(anyAlias, factory);

    let nodesToConvert: Map<ts.Node, ts.TypeNode>;
    let replaceRegions: ReplaceRegion[];
    return (file: ts.SourceFile) => {
      nodesToConvert = new Map();
      diags.forEach((diag) => {
        const conversion = getConversion(file, diag);
        if (conversion) {
          nodesToConvert.set(conversion.node, conversion.type);
        }
      });
      replaceRegions = computeReplaceRegions(nodesToConvert.keys());
      visit(file);
      return file;
    };

    function getConversion(file: ts.SourceFile, diag: ts.DiagnosticWithLocation): Conversion | null {
      const token = getTokenAtPosition(file, diag.start);
      switch (diag.code) {
        case 2339:
        case 7017: {
          if (!ts.isPropertyAccessExpression(token.parent) || isInJsxTagName(token.parent)) {
            return null;
          }
          // A mocked value keeps the rest of the member access checkable, the
          // way an index key does below; casting to `any` is the fallback.
          const mockType = checker && jestMockType(token.parent, checker, factory);
          return { node: token.parent.expression, type: mockType ?? anyType };
        }

        case 2571:
        case 18046:
          return isInJsxTagName(token) ? null : { node: token, type: anyType };

        case 7015:
        case 7053: {
          const access = findElementAccess(file, token, diag);
          if (!access) {
            return null;
          }
          // Casting the key keeps the element checkable and its value type
          // intact; casting the object away is the fallback.
          const keyType = checker && indexKeyType(access, checker, factory);
          return keyType
            ? { node: access.argumentExpression, type: keyType }
            : { node: access.expression, type: anyType };
        }

        default:
          return null;
      }
    }

    function visit(origNode: ts.Node): ts.Node | undefined {
      const conversionType = nodesToConvert.get(origNode);
      let node = ts.visitEachChild(origNode, visit, context);
      if (node === origNode && !conversionType) {
        return origNode;
      }

      if (conversionType) {
        node = factory.createAsExpression(node as ts.Expression, conversionType);
      }

      if (shouldReplace(node) && !inReplaceRegion(origNode)) {
        replaceNode(origNode, node);
        return origNode;
      }

      return node;
    }

    // A node inside a range owned by another node defers to that owner:
    // recording its own update would nest inside the owner's replacement.
    function inReplaceRegion(node: ts.Node): boolean {
      return replaceRegions.some(
        (region) => region.owner !== node && region.pos <= node.pos && node.end <= region.end,
      );
    }

    type ExpressionChild =
      | ts.DoStatement
      | ts.IfStatement
      | ts.SwitchStatement
      | ts.WithStatement
      | ts.WhileStatement;

    /** Where a node has both expression and statement children, only the
     * expression children are replaced: the statements were already replaced
     * lower down, and doing it again duplicates them or breaks the syntax. */
    function replaceNode(origNode: ts.Node, newNode: ts.Node): void {
      switch (origNode.kind) {
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.SwitchStatement:
        case ts.SyntaxKind.WithStatement:
        case ts.SyntaxKind.WhileStatement:
          updates.replaceNode(
            (origNode as ExpressionChild).expression,
            (newNode as ExpressionChild).expression,
          );
          break;

        case ts.SyntaxKind.ForStatement:
          updates.replaceNode(
            (origNode as ts.ForStatement).initializer,
            (newNode as ts.ForStatement).initializer,
          );
          updates.replaceNode(
            (origNode as ts.ForStatement).condition,
            (newNode as ts.ForStatement).condition,
          );
          updates.replaceNode(
            (origNode as ts.ForStatement).incrementor,
            (newNode as ts.ForStatement).incrementor,
          );
          break;

        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
          updates.replaceNode(
            (origNode as ts.ForInOrOfStatement).expression,
            (newNode as ts.ForInOrOfStatement).expression,
          );
          updates.replaceNode(
            (origNode as ts.ForInOrOfStatement).initializer,
            (newNode as ts.ForInOrOfStatement).initializer,
          );
          break;

        default:
          updates.replaceNode(origNode, newNode);
          break;
      }
    }
  };

type Conversion = { node: ts.Node; type: ts.TypeNode };

/** A tag name admits only an identifier, `this`, or a property access chain
 * over one, so a cast written there does not parse. */
function isInJsxTagName(node: ts.Node): boolean {
  let cur = node;
  while (ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur) {
    cur = cur.parent;
  }
  const { parent } = cur;
  return (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === cur
  );
}

type ReplaceRegion = { owner: ts.Node; pos: number; end: number };

/** Only the outermost range is kept: a nested text update would duplicate part
 * of the enclosing one, so inner changes bubble up into the owner's. */
function computeReplaceRegions(conversions: Iterable<ts.Node>): ReplaceRegion[] {
  const regions = Array.from(conversions, findReplaceRegion).filter((region) => region !== null);
  return regions.filter(
    (region) =>
      !regions.some(
        (other) =>
          other.pos <= region.pos &&
          region.end <= other.end &&
          (other.pos < region.pos || region.end < other.end),
      ),
  );
}

function findReplaceRegion(conversion: ts.Node): ReplaceRegion | null {
  let child = conversion;
  while (child.parent && !shouldReplace(child.parent)) {
    child = child.parent;
  }
  const { parent } = child;
  if (!parent || ts.isSourceFile(parent)) {
    return null;
  }
  switch (parent.kind) {
    // replaceNode rewrites only the direct expression children of these
    // statements, i.e. the child the conversion bubbled up through.
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.WithStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
      return { owner: parent, pos: child.pos, end: child.end };
    default:
      return { owner: parent, pos: parent.pos, end: parent.end };
  }
}

/** Replacing only the expression can produce invalid syntax through missing
 * parentheses, and can still lose whitespace where the expression sits in a
 * construct that can contain blocks. */
function shouldReplace(node: ts.Node): boolean {
  if (isStatement(node)) {
    return true;
  }
  switch (node.kind) {
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.EnumMember:
    case ts.SyntaxKind.HeritageClause:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.SourceFile: // In case we missed any other case.
      return true;
    default:
      return false;
  }
}

function isStatement(node: ts.Node): node is ts.Statement {
  return ts.SyntaxKind.FirstStatement <= node.kind && node.kind <= ts.SyntaxKind.LastStatement;
}

/** TS7053 spans the whole access, TS7015 spans only the index expression. */
function findElementAccess(
  file: ts.SourceFile,
  token: ts.Node,
  diag: ts.DiagnosticWithLocation,
): ts.ElementAccessExpression | null {
  const end = diag.start + diag.length;
  let node: ts.Node = token;
  while (node.parent && node.getStart(file) === diag.start && node.getEnd() < end) {
    node = node.parent;
  }
  if (node.getStart(file) !== diag.start || node.getEnd() !== end) {
    return null;
  }
  if (diag.code !== 7015) {
    return ts.isElementAccessExpression(node) ? node : null;
  }
  const { parent } = node;
  return parent && ts.isElementAccessExpression(parent) && parent.argumentExpression === node
    ? parent
    : null;
}

type KeyKind = 'string' | 'number' | 'symbol';

/**
 * Builds `keyof typeof obj` for an element access, or returns null when that
 * assertion would not check: an object a type query cannot name, an open type
 * (index signature), no visible properties, properties that do not share one
 * value type, or a key type that does not overlap the property names.
 */
function indexKeyType(
  access: ts.ElementAccessExpression,
  checker: ts.TypeChecker,
  factory: ts.NodeFactory,
): ts.TypeNode | null {
  const entityName = toEntityName(access.expression, factory);
  const symbol = entityName && checker.getSymbolAtLocation(access.expression);
  if (!entityName || !symbol) {
    return null;
  }

  // The type query names the symbol's declared type, so gate on that rather
  // than on the narrowed type at the access.
  const objectType = checker.getTypeOfSymbol(
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
  );
  if (!(objectType.flags & ts.TypeFlags.Object) || checker.getIndexInfosOfType(objectType).length) {
    return null;
  }

  const properties = checker.getPropertiesOfType(objectType).filter(isVisibleToKeyof);
  if (!properties.length) {
    return null;
  }
  // Indexing by the whole key union reads a union of the value types and writes
  // their intersection. Only one shared value type leaves both unchanged, so
  // anything the implicit any allowed still checks.
  const valueType = checker.getTypeOfSymbol(properties[0]);
  if (properties.some((property) => checker.getTypeOfSymbol(property) !== valueType)) {
    return null;
  }

  const keyKinds = new Set(properties.map(propertyKeyKind));
  const indexKinds = keyKindsOfType(checker.getTypeAtLocation(access.argumentExpression));
  if (!indexKinds) {
    return null;
  }
  // The assertion checks when every property name fits the index type, or when
  // every index constituent matches some property name.
  if (!isSubset(keyKinds, indexKinds) && !isSubset(indexKinds, keyKinds)) {
    return null;
  }

  return factory.createTypeOperatorNode(
    ts.SyntaxKind.KeyOfKeyword,
    factory.createTypeQueryNode(entityName),
  );
}

function toEntityName(expression: ts.Expression, factory: ts.NodeFactory): ts.EntityName | null {
  if (ts.isIdentifier(expression)) {
    return factory.createIdentifier(expression.text);
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    !expression.questionDotToken &&
    ts.isIdentifier(expression.name)
  ) {
    const left = toEntityName(expression.expression, factory);
    return left && factory.createQualifiedName(left, factory.createIdentifier(expression.name.text));
  }
  return null;
}

function propertyKeyKind(property: ts.Symbol): KeyKind {
  const name = String(property.escapedName);
  // Unique symbol keys are escaped as `__@name@id`.
  if (name.startsWith('__@')) {
    return 'symbol';
  }
  return `${Number(name)}` === name ? 'number' : 'string';
}

/** `keyof` skips private and protected members, which the property list keeps. */
function isVisibleToKeyof(property: ts.Symbol): boolean {
  return (
    !String(property.escapedName).startsWith('#') &&
    !(property.declarations ?? []).some(
      (declaration) =>
        (ts.getCombinedModifierFlags(declaration as ts.Declaration) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !==
        0,
    )
  );
}

function keyKindsOfType(type: ts.Type): Set<KeyKind> | null {
  const kinds = (type.isUnion() ? type.types : [type]).map(keyKindOfType);
  return kinds.includes(null) ? null : new Set(kinds as KeyKind[]);
}

function keyKindOfType(type: ts.Type): KeyKind | null {
  if (type.flags & ts.TypeFlags.StringLike) {
    return 'string';
  }
  if (type.flags & ts.TypeFlags.NumberLike) {
    return 'number';
  }
  if (type.flags & ts.TypeFlags.ESSymbolLike) {
    return 'symbol';
  }
  return null;
}

function isSubset(subset: Set<KeyKind>, superset: Set<KeyKind>): boolean {
  return Array.from(subset).every((kind) => superset.has(kind));
}
