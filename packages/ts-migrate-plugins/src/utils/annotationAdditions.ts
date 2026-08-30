/**
 * Adding members to a type node a pass has evidence for, and keeping only the
 * ones the checker accepts.
 *
 * Members are proved one at a time after the whole set fails, because a set is
 * only as good as its worst member: one member a narrow declared type
 * contradicts would otherwise cost the file every other member the same
 * annotation gained. A member the file rejects is dropped rather than widened:
 * a type the file contradicts was not proved, and the suppression that stands
 * in its place says so and withdraws itself once something declares the member.
 */
import ts from 'typescript';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from './candidateValidation';

const maxValidationPrograms = 12;

export interface AnnotationGroup {
  start: number;
  length: number;
  declared: string;
  /** A one-line type literal, which the members go inside rather than beside. */
  open: boolean;
  members: string[];
}

interface Addition {
  group: AnnotationGroup;
  member: string;
}

/** The span an annotation occupies, and the source text to write back into it. */
export interface AnnotationSlice {
  start: number;
  length: number;
  /** Source text, parenthesized where the joining type form cannot hold it as it stands. */
  text: string;
}

export function annotationSlice(
  annotation: ts.TypeNode,
  source: ts.SourceFile,
  needsParentheses: (typeNode: ts.TypeNode) => boolean,
): AnnotationSlice {
  const start = annotation.getStart(source);
  const text = source.text.slice(start, annotation.end);
  return {
    start,
    length: annotation.end - start,
    text: needsParentheses(annotation) ? `(${text})` : text,
  };
}

export function annotationGroup(annotation: ts.TypeNode, members: string[]): AnnotationGroup {
  const source = annotation.getSourceFile();
  const { start, length, text } = annotationSlice(annotation, source, needsIntersectionParentheses);
  return {
    start,
    length,
    declared: text,
    open: ts.isTypeLiteralNode(annotation) && !text.includes('\n'),
    members,
  };
}

export function applyProvenAdditions(
  fileName: string,
  text: string,
  groups: AnnotationGroup[],
  languageService: ts.LanguageService,
): string | undefined {
  const program = languageService.getProgram();
  const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});
  const baseline = createFileLanguageService(fileName, text, compilerOptions, program);
  const baselineSyntacticCount = baseline.getSyntacticDiagnostics(fileName).length;
  let programsLeft = maxValidationPrograms;

  const attempt = (accepted: Addition[]): string | undefined => {
    if (programsLeft <= 0) return undefined;
    programsLeft -= 1;
    const changes = changesOf(groups, accepted);
    const candidateText = applyTextChanges(text, changes);
    const candidate = createFileLanguageService(fileName, candidateText, compilerOptions, program);
    if (candidate.getSyntacticDiagnostics(fileName).length !== baselineSyntacticCount) {
      return undefined;
    }
    return findNewErrors(baseline, candidate, changes, fileName).length > 0
      ? undefined
      : candidateText;
  };

  const all = groups.flatMap((group) => group.members.map((member) => ({ group, member })));
  const whole = attempt(all);
  if (whole || all.length === 1) return whole;

  const accepted: Addition[] = [];
  let kept: string | undefined;
  all.forEach((addition) => {
    const next = attempt([...accepted, addition]);
    if (!next) return;
    accepted.push(addition);
    kept = next;
  });
  return kept;
}

function changesOf(groups: AnnotationGroup[], accepted: Addition[]): TextChange[] {
  const changes: TextChange[] = [];
  groups.forEach((group) => {
    const members = accepted
      .filter((addition) => addition.group === group)
      .map((addition) => addition.member);
    if (members.length > 0) changes.push(changeFor(group, members));
  });
  return changes;
}

function changeFor(group: AnnotationGroup, members: string[]): TextChange {
  const addition = `{ ${members.join('; ')} }`;
  if (!group.open) {
    return { start: group.start, length: group.length, text: `${group.declared} & ${addition}` };
  }
  const inner = group.declared.slice(1, -1).trim().replace(/[;,]$/, '');
  return {
    start: group.start,
    length: group.length,
    text: inner ? `{ ${inner}; ${members.join('; ')} }` : addition,
  };
}

/** Type forms an intersection cannot hold as its left operand unparenthesized. */
export function needsIntersectionParentheses(typeNode: ts.TypeNode): boolean {
  return (
    ts.isUnionTypeNode(typeNode) ||
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    ts.isConditionalTypeNode(typeNode) ||
    ts.isInferTypeNode(typeNode)
  );
}
