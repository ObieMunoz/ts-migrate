/**
 * Adding members to a type node a pass has evidence for, and keeping only the
 * ones the checker accepts.
 *
 * Members are proved one at a time after the whole set fails, because a set is
 * only as good as its worst member: one member a narrow declared type
 * contradicts would otherwise cost the file every other member the same
 * annotation gained. A member the file rejects is retried as `any`, which keeps
 * the name the pass had evidence for when only the type it inferred was wrong.
 */
import ts from 'typescript';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from './candidateValidation';

const maxValidationPrograms = 16;

export interface Member {
  name: string;
  type: string;
}

export interface AnnotationGroup {
  start: number;
  length: number;
  declared: string;
  /** A one-line type literal, which the members go inside rather than beside. */
  open: boolean;
  members: Member[];
}

interface Addition {
  group: AnnotationGroup;
  member: Member;
}

export function annotationGroup(annotation: ts.TypeNode, members: Member[]): AnnotationGroup {
  const source = annotation.getSourceFile();
  const start = annotation.getStart(source);
  const declared = source.text.slice(start, annotation.end);
  return {
    start,
    length: annotation.end - start,
    declared: needsParentheses(annotation) ? `(${declared})` : declared,
    open: ts.isTypeLiteralNode(annotation) && !declared.includes('\n'),
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
  if (whole) return whole;

  const accepted: Addition[] = [];
  let kept: string | undefined;
  all.forEach((addition) => {
    const next = attempt([...accepted, addition]);
    if (next) {
      accepted.push(addition);
      kept = next;
      return;
    }
    if (addition.member.type === 'any') return;
    const widened = { group: addition.group, member: { name: addition.member.name, type: 'any' } };
    const fallback = attempt([...accepted, widened]);
    if (!fallback) return;
    accepted.push(widened);
    kept = fallback;
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

function changeFor(group: AnnotationGroup, members: Member[]): TextChange {
  const spelled = members.map((member) => `${member.name}?: ${member.type}`);
  const addition = `{ ${spelled.join('; ')} }`;
  if (!group.open) {
    return { start: group.start, length: group.length, text: `${group.declared} & ${addition}` };
  }
  const inner = group.declared.slice(1, -1).trim().replace(/[;,]$/, '');
  return {
    start: group.start,
    length: group.length,
    text: inner ? `{ ${inner}; ${spelled.join('; ')} }` : addition,
  };
}

function needsParentheses(typeNode: ts.TypeNode): boolean {
  return (
    ts.isUnionTypeNode(typeNode) ||
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    ts.isConditionalTypeNode(typeNode) ||
    ts.isInferTypeNode(typeNode)
  );
}
