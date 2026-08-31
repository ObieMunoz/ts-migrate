import ts from 'typescript';

/**
 * Whether the declaration carries a `static` modifier. Accepts any declaration,
 * so callers do not need to narrow `ts.ClassElement` to a node type that has
 * a `modifiers` property.
 */
export function isStatic(member: ts.Declaration): boolean {
  return (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
}

/**
 * Whether the node carries a modifier of the given kind. Accepts any node that
 * can have modifiers, so callers do not need to narrow to a node type whose
 * `modifiers` array has a particular element type.
 */
export function hasModifier(node: ts.HasModifiers, kind: ts.ModifierSyntaxKind): boolean {
  return node.modifiers != null && node.modifiers.some((modifier) => modifier.kind === kind);
}

/** Whether the node carries any modifier other than the given kind. */
export function hasModifierOtherThan(node: ts.HasModifiers, kind: ts.ModifierSyntaxKind): boolean {
  return node.modifiers != null && node.modifiers.some((modifier) => modifier.kind !== kind);
}
