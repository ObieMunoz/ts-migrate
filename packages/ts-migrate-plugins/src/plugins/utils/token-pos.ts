import ts from 'typescript';

/**
 * Returns the token whose text contains the position.
 * If the position is past the end of the file, then it returns the file node itself.
 *
 * This function is adapted from TypeScript:
 * https://github.com/microsoft/TypeScript/blob/v4.1.3/src/services/utilities.ts#L1095
 */
export default function getTokenAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node {
  let current: ts.Node = sourceFile;
  outer: while (true) {
    // find the child that contains 'position'
    for (const child of current.getChildren(sourceFile)) {
      const start = child.getFullStart();
      if (start > position) {
        // If this child begins after position, then all subsequent children will as well.
        break;
      }

      const end = child.getEnd();
      if (position < end || (position === end && child.kind === ts.SyntaxKind.EndOfFileToken)) {
        current = child;
        continue outer;
      }
    }

    return current;
  }
}

/** The innermost node whose span matches the diagnostic exactly. */
export function findNodeAtSpan(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
): ts.Node | undefined {
  const end = diagnostic.start + diagnostic.length;
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) > diagnostic.start || node.end < end) return;
    if (node.getStart(sourceFile) === diagnostic.start && node.end === end) {
      result = node;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return result;
}

/**
 * The innermost node the position falls inside, or undefined when it falls in
 * trivia, which belongs to no node.
 */
export function innermostNodeAt(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Node | undefined {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (position < node.getStart(sourceFile) || position >= node.end) return;
    result = node;
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return result;
}
