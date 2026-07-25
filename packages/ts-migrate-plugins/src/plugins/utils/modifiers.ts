import ts from 'typescript';

/**
 * Whether the declaration carries a `static` modifier. Accepts any declaration,
 * so callers do not need to narrow `ts.ClassElement` to a node type that has
 * a `modifiers` property.
 */
export function isStatic(member: ts.Declaration): boolean {
  return (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
}
