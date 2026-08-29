import ts from 'typescript';
import getTokenAtPosition from './token-pos';
import { TextChange, toOriginalPos } from '../../utils/candidateValidation';

export function isOverloaded(
  declaration: ts.SignatureDeclaration,
  checker: ts.TypeChecker,
): boolean {
  const { name } = declaration;
  if (!name) return false;
  const symbol = checker.getSymbolAtLocation(name);
  if (!symbol?.declarations) return false;
  return symbol.declarations.filter(ts.isFunctionLike).length > 1;
}

export function contestedSpans(
  errors: ts.Diagnostic[],
  changes: TextChange[],
  sourceFile: ts.SourceFile,
): ts.TextRange[] {
  const spans: ts.TextRange[] = [];
  errors.forEach((error) => {
    if (error.start == null) return;
    let node: ts.Node | undefined = getTokenAtPosition(
      sourceFile,
      toOriginalPos(error.start, changes),
    );
    while (node) {
      if (ts.isFunctionLike(node)) spans.push({ pos: node.pos, end: node.end });
      node = node.parent;
    }
  });
  return spans;
}
