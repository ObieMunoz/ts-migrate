import ts from 'typescript';

/**
 * Replaces the body of prevText with printed, keeping the leading and trailing
 * whitespace the original text carried.
 */
export function spliceKeepingWhitespace(prevText: string, printed: string): string {
  return prevText.replace(/^(\s*)[^]*?(\s*)$/, (_match, p1, p2) => `${p1}${printed}${p2}`);
}

export function getTextPreservingWhitespace(
  prevNode: ts.Node,
  nextNode: ts.Node,
  sourceFile: ts.SourceFile,
): string {
  const printer = ts.createPrinter();
  const printedNextNode = printer.printNode(ts.EmitHint.Unspecified, nextNode, sourceFile);
  return spliceKeepingWhitespace(prevNode.getFullText(sourceFile), printedNextNode);
}
