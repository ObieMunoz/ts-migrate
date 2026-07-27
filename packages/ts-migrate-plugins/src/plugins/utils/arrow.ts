import ts from 'typescript';

/**
 * Whether an arrow function writes its parameter list in parentheses. The
 * parenthesis is looked for among all of the children rather than at the first
 * token, which is `async` on an async arrow and `<` on a generic one.
 */
export function hasParameterParentheses(fn: ts.ArrowFunction, sourceFile: ts.SourceFile): boolean {
  return fn.getChildren(sourceFile).some((child) => child.kind === ts.SyntaxKind.OpenParenToken);
}
