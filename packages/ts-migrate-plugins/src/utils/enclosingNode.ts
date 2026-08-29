import ts from 'typescript';

/**
 * The smallest node whose span contains the given span. This is not the
 * `findNodeAtSpan` in plugins/utils/token-pos, which wants an exact match.
 */
export default function findEnclosingNode(
  file: ts.SourceFile,
  start: number,
  length: number,
): ts.Node | undefined {
  const end = start + length;
  let best: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(file) > start || end > node.getEnd()) return;
    if (!best || node.getEnd() - node.getStart(file) <= best.getEnd() - best.getStart(file)) {
      best = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return best;
}
