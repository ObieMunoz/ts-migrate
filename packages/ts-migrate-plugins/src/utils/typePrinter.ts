import ts from 'typescript';

/** Why a type cannot be written into the file. */
export type TypePrintRefusal =
  | 'any'
  | 'unknown'
  | 'never'
  | 'void'
  | 'anonymous'
  | 'union-too-large'
  | 'type-arguments'
  | 'needs-import'
  | 'unprintable';

export interface PrintedType {
  printable: true;
  /** Source text for the type, ready to splice in at `at`. */
  text: string;
  /** `text` split on its top level unions, in order and deduplicated. */
  members: string[];
}

export interface UnprintableType {
  printable: false;
  reason: TypePrintRefusal;
}

export type PrintTypeResult = PrintedType | UnprintableType;

export interface PrintTypeOptions {
  /** Top level union members allowed before the whole type is refused. */
  maxUnionMembers?: number;
  /** Print `"a"` as `string`, `7` as `number` and `true` as `boolean`. */
  widenLiterals?: boolean;
}

export const DEFAULT_MAX_UNION_MEMBERS = 4;

/**
 * Union constituents printed before the type is refused outright. The cap that
 * matters is on the printed members, which deduplication and literal widening
 * can bring far below this; this one only keeps a pathological union from
 * being printed member by member first.
 */
const MAX_UNION_CONSTITUENTS = 64;

/** The report exists to be spliced into source, so nothing may be elided. */
const TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation;

/** A bare or dotted name, the only shape a named type is accepted in. */
const TYPE_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

const PRIMITIVE_FLAGS =
  ts.TypeFlags.String |
  ts.TypeFlags.Number |
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BigInt |
  ts.TypeFlags.ESSymbol |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.NonPrimitive;

const LITERAL_FLAGS =
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BigIntLiteral |
  ts.TypeFlags.BooleanLiteral;

function refuse(reason: TypePrintRefusal): UnprintableType {
  return { printable: false, reason };
}

function printed(text: string): PrintedType {
  return { printable: true, text, members: [text] };
}

/**
 * Writes a checker type as source text for the scope `at` sits in, and refuses
 * rather than guess when the result would not be usable there.
 *
 * A type is refused when it cannot be named without an import, when it is an
 * anonymous object or function shape, when it is a generic that would need its
 * type arguments spelled out, when its union is wider than `maxUnionMembers`,
 * and when it is `any`, `unknown`, `never` or `void`. `any` is called out on
 * its own: it is assignable both ways, so a caller validating a candidate by
 * re-checking the file gets no signal from it, and a `T | any` written into an
 * annotation silently erases `T`.
 *
 * A `void` constituent refuses the union around it rather than being dropped
 * from it. What comes back is the type it was handed or nothing, so a caller
 * that wants a narrower type than the checker gave it narrows before printing,
 * the way retry-conversions drops null and undefined from an operand.
 *
 * Accessibility comes from the compiler: `typeToString` given an enclosing
 * declaration prints a symbol it cannot reach from there as
 * `import("/path").Foo`, which is refused. Callers that re-check the file after
 * splicing get a second net, since a name that does not resolve is a new
 * TS2304.
 */
export function printType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  options: PrintTypeOptions = {},
): PrintTypeResult {
  const maxUnionMembers = options.maxUnionMembers ?? DEFAULT_MAX_UNION_MEMBERS;
  const constituents = unionConstituents(type);
  if (constituents.length > MAX_UNION_CONSTITUENTS) return refuse('union-too-large');

  const printedMembers: string[] = [];
  for (const constituent of constituents) {
    const member = printMember(checker, constituent, at, options);
    if (!member.printable) return member;
    member.members.forEach((text) => {
      if (!printedMembers.includes(text)) printedMembers.push(text);
    });
  }

  const members = collapseBooleanLiterals(printedMembers);
  if (members.length === 0) return refuse('unprintable');
  if (members.length > maxUnionMembers) return refuse('union-too-large');
  return { printable: true, text: members.join(' | '), members };
}

/** The `boolean` intrinsic is a union of its two literals and prints as one name. */
function unionConstituents(type: ts.Type): ts.Type[] {
  if ((type.flags & ts.TypeFlags.Boolean) !== 0) return [type];
  return type.isUnion() ? [...type.types] : [type];
}

/** A union holding `boolean` carries its two literals, as the checker flattened them. */
function collapseBooleanLiterals(members: string[]): string[] {
  if (!members.includes('true') || !members.includes('false')) return members;
  return members
    .filter((member) => member !== 'false')
    .map((member) => (member === 'true' ? 'boolean' : member));
}

function printMember(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  options: PrintTypeOptions,
): PrintTypeResult {
  if ((type.flags & ts.TypeFlags.Any) !== 0) return refuse('any');
  if ((type.flags & ts.TypeFlags.Unknown) !== 0) return refuse('unknown');
  if ((type.flags & ts.TypeFlags.Never) !== 0) return refuse('never');
  if ((type.flags & ts.TypeFlags.Void) !== 0) return refuse('void');

  const member = isWidenableLiteral(type, options) ? checker.getBaseTypeOfLiteralType(type) : type;

  if ((member.flags & PRIMITIVE_FLAGS) !== 0) return keyword(checker, member, at);
  if ((member.flags & LITERAL_FLAGS) !== 0 && (member.flags & ts.TypeFlags.EnumLiteral) === 0) {
    return keyword(checker, member, at);
  }
  if ((member.flags & ts.TypeFlags.Object) !== 0) {
    return printObject(checker, member as ts.ObjectType, at, options);
  }
  if ((member.flags & (ts.TypeFlags.EnumLike | ts.TypeFlags.TypeParameter)) !== 0) {
    return printNamed(checker, member, at);
  }
  return refuse('unprintable');
}

function isWidenableLiteral(type: ts.Type, options: PrintTypeOptions): boolean {
  return (
    (options.widenLiterals ?? false) &&
    (type.flags & ts.TypeFlags.Literal) !== 0 &&
    (type.flags & ts.TypeFlags.EnumLiteral) === 0
  );
}

/** Primitives and literals print as themselves and need nothing in scope. */
function keyword(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): PrintTypeResult {
  const text = checker.typeToString(type, at, TYPE_FORMAT_FLAGS);
  return /^[^\s{}<>()[\]|&]+$/.test(text) ? printed(text) : refuse('unprintable');
}

function printObject(
  checker: ts.TypeChecker,
  type: ts.ObjectType,
  at: ts.Node,
  options: PrintTypeOptions,
): PrintTypeResult {
  const typeArguments =
    (type.objectFlags & ts.ObjectFlags.Reference) !== 0
      ? checker.getTypeArguments(type as ts.TypeReference)
      : [];

  if (isArray(type, typeArguments)) {
    const element = printType(checker, typeArguments[0], at, options);
    if (!element.printable) return element;
    return printed(element.members.length > 1 ? `(${element.text})[]` : `${element.text}[]`);
  }
  if (typeArguments.length > 0) return refuse('type-arguments');
  return printNamed(checker, type, at);
}

function isArray(type: ts.ObjectType, typeArguments: readonly ts.Type[]): boolean {
  return (
    typeArguments.length === 1 &&
    (type.objectFlags & ts.ObjectFlags.Tuple) === 0 &&
    type.getSymbol()?.getName() === 'Array'
  );
}

function printNamed(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): PrintTypeResult {
  // Anonymous shapes are named `__type` or `__object` by the binder.
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  if (!name || name.startsWith('__')) return refuse('anonymous');

  const text = checker.typeToString(type, at, TYPE_FORMAT_FLAGS);
  if (text.includes('import(')) return refuse('needs-import');
  if (!TYPE_NAME.test(text)) return refuse(text.includes('<') ? 'type-arguments' : 'anonymous');
  return printed(text);
}
