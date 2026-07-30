import ts from 'typescript';

/**
 * The methods jest puts on a mock function, minus the ones whose names a real
 * API could plausibly use. A member access that failed on one of these is a
 * mocked module export the checker still reads as the real declaration.
 */
const mockMethods = new Set([
  'mockClear',
  'mockImplementation',
  'mockImplementationOnce',
  'mockName',
  'mockReset',
  'mockRestore',
  'mockRejectedValue',
  'mockRejectedValueOnce',
  'mockResolvedValue',
  'mockResolvedValueOnce',
  'mockReturnThis',
  'mockReturnValue',
  'mockReturnValueOnce',
]);

// `isTypeAssignableTo` is @internal on ts.TypeChecker and missing from the
// public type.
type AssignabilityReader = { isTypeAssignableTo?(source: ts.Type, target: ts.Type): boolean };

/**
 * `jest.Mock` for a member access the checker rejected, where the member is a
 * jest mock method: the test replaced the module, so the value is a mock
 * function whatever the export it came from declares. That holds however the
 * value reached the access, so the member name is the whole signal, and no
 * `jest.mock` call has to be found and resolved to the operand's module. The
 * evidence would not survive that walk anyway, since a mocked module is often
 * automocked with no factory to read and read through a local alias.
 *
 * Null unless the assertion compiles. The name has to resolve, which it does
 * not without `@types/jest`, nor in a project on `@jest/globals` where `jest`
 * is a value and not a namespace. `Mock` also does not overlap every operand:
 * an export that is a plain object, or a function carrying properties of its
 * own the way node's `setTimeout` does, gives TS2352 instead of a cast that
 * works.
 */
export function jestMockType(
  access: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  factory: ts.NodeFactory,
): ts.TypeNode | null {
  if (!ts.isIdentifier(access.name) || !mockMethods.has(access.name.text)) {
    return null;
  }
  const mockType = resolveMockType(checker, access);
  if (!mockType || !isAssertable(checker, checker.getTypeAtLocation(access.expression), mockType)) {
    return null;
  }
  return factory.createTypeReferenceNode(
    factory.createQualifiedName(factory.createIdentifier('jest'), factory.createIdentifier('Mock')),
    undefined,
  );
}

/**
 * The type the name `jest.Mock` denotes here, carrying the type arguments it
 * defaults to.
 *
 * Read off what `jest.fn` returns rather than off the declared type of the
 * `Mock` symbol, which is the generic `Mock<T, Y>`: assignability answered
 * against its own type parameters bears no relation to the answer for the type
 * the written name resolves to. The overload taken is one returning that same
 * symbol with no type parameter left in it, so the type gated on is the one
 * the name means.
 */
function resolveMockType(checker: ts.TypeChecker, location: ts.Node): ts.Type | undefined {
  const jestSymbol = checker
    .getSymbolsInScope(location, ts.SymbolFlags.Namespace)
    .find((symbol) => symbol.getName() === 'jest');
  const mockSymbol = jestSymbol?.exports?.get('Mock' as ts.__String);
  const fnSymbol = jestSymbol?.exports?.get('fn' as ts.__String);
  if (!mockSymbol || !fnSymbol) {
    return undefined;
  }
  return checker
    .getSignaturesOfType(
      checker.getTypeOfSymbolAtLocation(fnSymbol, location),
      ts.SignatureKind.Call,
    )
    .map((signature) => checker.getReturnTypeOfSignature(signature))
    .find(
      (type) =>
        type.symbol === mockSymbol &&
        !checker
          .getTypeArguments(type as ts.TypeReference)
          .some((argument) => (argument.flags & ts.TypeFlags.TypeParameter) !== 0),
    );
}

/**
 * Whether `operand as Mock` compiles. An assertion needs the two types to be
 * comparable, a relation the checker does not expose, so assignability either
 * way stands in for it: it is the stricter of the two, so an answer of true is
 * one TypeScript accepts as well.
 */
function isAssertable(checker: ts.TypeChecker, operandType: ts.Type, mockType: ts.Type): boolean {
  const isAssignable = (checker as AssignabilityReader).isTypeAssignableTo;
  if (!isAssignable) {
    return false;
  }
  return (
    isAssignable.call(checker, operandType, mockType) ||
    isAssignable.call(checker, mockType, operandType)
  );
}
