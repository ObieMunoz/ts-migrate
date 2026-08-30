import ts from 'typescript';

/**
 * Whether the declaration carries a `static` modifier. Accepts any declaration,
 * so callers do not need to narrow `ts.ClassElement` to a node type that has
 * a `modifiers` property.
 */
export function isStatic(member: ts.Declaration): boolean {
  return (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
}

/** Whether `modifiers` contains a modifier of the given kind. */
export function hasModifier(
  modifiers: ts.NodeArray<ts.ModifierLike> | undefined,
  kind: ts.SyntaxKind,
): boolean {
  return modifiers != null && modifiers.some((modifier) => modifier.kind === kind);
}

/**
 * Whether every modifier is of the given kind. An absent modifier list carries
 * no disqualifying modifier, so it satisfies the check.
 */
export function hasOnlyModifier(
  modifiers: ts.NodeArray<ts.ModifierLike> | undefined,
  kind: ts.SyntaxKind,
): boolean {
  return modifiers == null || modifiers.every((modifier) => modifier.kind === kind);
}
