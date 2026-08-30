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

/**
 * The first node in pre-order that ends at `end` and that `match` accepts. This
 * is not the `findNodeAtSpan` in plugins/utils/token-pos, which wants both ends
 * to line up. The walk skips a subtree that ends before `end` or starts after
 * it, and stops descending once it has a hit.
 */
export function findNodeEndingAt<T extends ts.Node>(
  source: ts.SourceFile,
  end: number,
  match: (node: ts.Node) => node is T,
): T | undefined {
  let found: T | undefined;
  const visit = (node: ts.Node): void => {
    if (found || node.end < end || node.getStart(source) > end) return;
    if (node.end === end && match(node)) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return found;
}

/**
 * The source file `fileName` holds in the service's current program, with that
 * program's checker.
 */
export function programSourceAndChecker(
  service: ts.LanguageService,
  fileName: string,
): { source: ts.SourceFile; checker: ts.TypeChecker } | undefined {
  const program = service.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!program || !source) return undefined;
  return { source, checker: program.getTypeChecker() };
}

/**
 * The node `findNodeEndingAt` accepts in the re-checked `fileName`, paired with
 * the checker that can answer questions about it.
 */
export function checkedNodeEndingAt<T extends ts.Node>(
  service: ts.LanguageService,
  fileName: string,
  end: number,
  match: (node: ts.Node) => node is T,
): { node: T; checker: ts.TypeChecker } | undefined {
  const checked = programSourceAndChecker(service, fileName);
  if (!checked) return undefined;
  const node = findNodeEndingAt(checked.source, end, match);
  return node && { node, checker: checked.checker };
}
