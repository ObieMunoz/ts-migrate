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
