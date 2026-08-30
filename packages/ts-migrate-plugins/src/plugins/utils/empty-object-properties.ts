/**
 * The property list an empty object literal gets from the values written onto
 * it: `cache = {}` with `cache.total = 1` becomes `{ total?: number }`.
 *
 * Properties are declared optional. Required ones would not match the empty
 * initializer, and optional reads the same whether or not strictNullChecks is
 * on. Each property takes the widened checker type of the values assigned to
 * it, except where that type is `any` or one of the spellings the checker uses
 * when it found nothing (`never[]`, `{}`, `null`), which take the any alias
 * instead of a type nothing supports.
 *
 * Shared by declare-empty-object-properties, which annotates a declaration
 * whose initializer is the literal, and declare-missing-class-properties,
 * which declares the property a constructor assigns the literal to.
 */
import ts from 'typescript';
import { isIdentifierName } from './identifiers';

// What a write to an unannotated `= {}` reports. TS2339 spans the property
// name, TS7053 the whole element access.
export const blamableDiagnosticCodes = new Set([
  // TS2339: Property '{0}' does not exist on type '{1}'.
  2339,
  // TS7053: Element implicitly has an 'any' type because expression of type
  // '{0}' can't be used to index type '{1}'.
  7053,
]);

// How deep a type is walked looking for the spellings that mean "no evidence".
const maxTypeDepth = 4;

/** One property to declare, name and type already printed. */
export interface Property {
  name: string;
  /** Absent where the assigned values gave no evidence and the alias is used. */
  type?: string;
}

/** A `name.key = value` or `name['key'] = value` assignment. */
export interface Write {
  key: string;
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  value: ts.Expression;
}

export interface PrintContext {
  /** The scope the printed types are resolved from. */
  enclosingDeclaration: ts.Node;
  source: ts.SourceFile;
  checker: ts.TypeChecker;
  printer: ts.Printer;
}

export function isEmptyObject(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isObjectLiteralExpression(node) && node.properties.length === 0;
}

/**
 * Assignments through a fixed key: the ones a property list can describe. What
 * is written to is left to the caller, so `this.foo.x`, `C.foo.x` and `cache.x`
 * are all recognized here and resolved to a declaration separately.
 */
export function asWrite(node: ts.Node): Write | undefined {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  const { left } = node;
  if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.name)) {
    return { key: left.name.text, access: left, value: node.right };
  }
  if (ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression)) {
    return { key: left.argumentExpression.text, access: left, value: node.right };
  }
  return undefined;
}

/** Whether a reported error covers the write, which is what the list would fix. */
export function isBlamed(
  write: Write,
  source: ts.SourceFile,
  diagnostics: ts.Diagnostic[],
): boolean {
  const start = write.access.getStart(source);
  const { end } = write.access;
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.start != null &&
      diagnostic.start < end &&
      diagnostic.start + (diagnostic.length ?? 0) > start,
  );
}

/**
 * One optional property per key, in the order the keys are first assigned,
 * typed as the union of the widened types assigned to it.
 */
export function declareProperties(writes: Write[], context: PrintContext): Property[] {
  const byKey = new Map<string, string[]>();
  const aliased = new Set<string>();

  writes.forEach((write) => {
    let types = byKey.get(write.key);
    if (!types) {
      types = [];
      byKey.set(write.key, types);
    }
    const type = printType(write.value, context);
    if (type === undefined) {
      aliased.add(write.key);
    } else if (!types.includes(type)) {
      types.push(type);
    }
  });

  return Array.from(byKey, ([key, types]) => ({
    name: isIdentifierName(key) ? key : JSON.stringify(key),
    ...(aliased.has(key) || types.length === 0 ? undefined : { type: types.join(' | ') }),
  }));
}

/** The property list as it is written, with the alias spelled `anyType`. */
export function printProperties(properties: Property[], anyType: string): string {
  return `{ ${properties
    .map((property) => `${property.name}?: ${property.type ?? anyType}`)
    .join('; ')} }`;
}

/**
 * The assigned value's type as it would be written at the declaration, or
 * undefined where the checker knows nothing worth writing down.
 */
function printType(value: ts.Expression, context: PrintContext): string | undefined {
  const { enclosingDeclaration, source, checker, printer } = context;
  const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(value));
  if (isNoEvidence(type, checker)) {
    return undefined;
  }
  const typeNode = checker.typeToTypeNode(
    type,
    enclosingDeclaration,
    ts.NodeBuilderFlags.NoTruncation,
  );
  if (!typeNode) {
    return undefined;
  }
  try {
    return printer.printNode(ts.EmitHint.Unspecified, typeNode, source);
  } catch {
    return undefined;
  }
}

/** `null`, `undefined` and `void`: real types that describe no value. */
function isVacuous(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
}

/**
 * Whether a type says nothing an annotation could rest on. `any` is
 * assignable in both directions, so no re-check rejects it and it has to be
 * ruled out here; the empty object type and an array with no element type are
 * what the checker prints where it found no evidence at all, and an
 * annotation built from either rejects every value added later.
 */
function isNoEvidence(type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) !== 0 || isVacuous(type)) {
    return true;
  }
  if (depth >= maxTypeDepth) {
    return false;
  }
  if (type.isUnion()) {
    return type.types.every((member) => isNoEvidence(member, checker, depth + 1));
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const elements = checker.getTypeArguments(type as ts.TypeReference);
    return (
      elements.length === 0 || elements.some((element) => isNoEvidence(element, checker, depth + 1))
    );
  }
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.ObjectLiteral) !== 0 &&
    checker.getPropertiesOfType(type).length === 0
  );
}
