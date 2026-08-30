import ts from 'typescript';
import getTokenAtPosition from './token-pos';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toOriginalPos,
} from '../../utils/candidateValidation';

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

function contestedSpans(
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

/**
 * The changes that cost the declaring file nothing. A relaxation widens what
 * the parameter reads as inside the body, which the body can contradict;
 * those are dropped and the rest kept.
 */
export function provenChanges<T extends TextChange>(
  fileName: string,
  text: string,
  sourceFile: ts.SourceFile,
  changes: T[],
  languageService: ts.LanguageService,
): T[] | undefined {
  const program = languageService.getProgram();
  const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});
  const baseline = createFileLanguageService(fileName, text, compilerOptions, program);

  let kept = changes;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateText = applyTextChanges(text, kept);
    const candidate = createFileLanguageService(fileName, candidateText, compilerOptions, program);
    const newErrors = findNewErrors(baseline, candidate, kept, fileName);
    if (newErrors.length === 0) return kept;

    const contested = contestedSpans(newErrors, kept, sourceFile);
    const remaining = kept.filter(
      (change) => !contested.some(({ pos, end }) => change.start >= pos && change.start <= end),
    );
    if (remaining.length === kept.length || remaining.length === 0) return undefined;
    kept = remaining;
  }
  return undefined;
}
