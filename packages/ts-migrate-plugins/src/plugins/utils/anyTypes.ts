import ts from 'typescript';

/**
 * A type node that is `any`, or a bare name that could resolve to an alias for
 * it. Cheap enough to filter with before a checker is asked for, which is what
 * the collecting pass of a plugin has to do.
 */
export function isAnyOrAliasReference(typeNode: ts.TypeNode): boolean {
  return (
    typeNode.kind === ts.SyntaxKind.AnyKeyword ||
    (ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeArguments == null)
  );
}

/**
 * Whether the type node is the one ts-migrate writes for a type it could not
 * work out: `any`, or the alias it takes from config, read here as any alias
 * the project declares as `any` rather than as a hardcoded name.
 *
 * An alias for a function type (`$TSFixMeFunction`) is deliberately not one of
 * these. The gate a retry passes is that the checker no longer answers `any`,
 * and a function type passes that gate whether anything improved or not.
 */
export function isAnyType(typeNode: ts.TypeNode, checker: ts.TypeChecker): boolean {
  if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
    return true;
  }
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(typeNode.typeName);
  return (symbol?.declarations ?? []).some(
    (declaration) =>
      ts.isTypeAliasDeclaration(declaration) && declaration.type.kind === ts.SyntaxKind.AnyKeyword,
  );
}
