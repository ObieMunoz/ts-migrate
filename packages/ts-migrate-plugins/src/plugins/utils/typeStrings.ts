import ts from 'typescript';

// Split a type string on `sep` only at depth 0 (not inside < > ( ) [ ] { }).
export function splitTopLevel(str: string, sep: string): string[] {
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
export function buildTypeNode(typeStr: string, anyAlias?: string): ts.TypeNode {
  typeStr = typeStr.trim();

  // Union type: split at top-level ' | '
  const unionParts = splitTopLevel(typeStr, ' | ');
  if (unionParts.length > 1) {
    return ts.factory.createUnionTypeNode(unionParts.map((p) => buildTypeNode(p, anyAlias)));
  }

  // typeof query: `typeof someValue` (possibly dotted, e.g. `typeof ns.value`).
  const typeofMatch = /^typeof\s+([A-Za-z_$][A-Za-z0-9_$.]*)$/.exec(typeStr);
  if (typeofMatch) {
    const parts = typeofMatch[1].split('.');
    let entityName: ts.EntityName = ts.factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      entityName = ts.factory.createQualifiedName(
        entityName,
        ts.factory.createIdentifier(parts[i]),
      );
    }
    return ts.factory.createTypeQueryNode(entityName);
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
//
// When `dropAny` is set, `any`/`anyAlias` observations are treated as carrying
// no information and are dropped in favour of concrete observations (only
// collapsing to `any` when every observation is `any`). This suits evidence
// merged from mixed sources — e.g. a state field seen as `string` in the
// initial state but as an untyped (`any`) `setState` shorthand should stay
// `string`. Without it (the default), a single `any` observation absorbs the
// union, which is the desired behaviour for prop call-site inference.
export function widenTypes(
  observedTypes: string[],
  anyAlias?: string,
  dropAny = false,
): string {
  if (observedTypes.length === 0) return anyAlias ?? 'any';
  const anyType = anyAlias ?? 'any';

  const isAny = (t: string) => t === 'any' || (anyAlias != null && t === anyAlias);

  // Flatten each observation into its top-level union members so that a nested
  // member (e.g. the `null` inside `FieldNotification | null`) dedupes against
  // a standalone observation of the same type, rather than being treated as an
  // opaque atom (which would yield `null | FieldNotification | null`).
  let unique = [
    ...new Set(observedTypes.flatMap((t) => splitTopLevel(t, ' | ').map((p) => p.trim()))),
  ];

  if (dropAny) {
    const concrete = unique.filter((t) => !isAny(t));
    // If concrete evidence exists, ignore the `any` observations entirely;
    // otherwise fall through to the plain `any` result below.
    if (concrete.length > 0) unique = concrete;
  }

  if (unique.some(isAny)) {
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

// True when a type string cannot be reconstructed as anything more specific
// than `any` (e.g. function types `(x) => y` or object types `{ ... }`, which
// buildTypeNode does not parse). Used to decide when to try a `typeof`
// fallback instead of emitting a useless `any`.
export function typeStrDegradesToAny(typeStr: string): boolean {
  return buildTypeNode(typeStr).kind === ts.SyntaxKind.AnyKeyword;
}
