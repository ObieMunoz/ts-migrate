import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toCandidatePos,
} from '../utils/candidateValidation';
import { printType } from '../utils/typePrinter';
import { isAnyOrAliasReference, isAnyType } from './utils/anyTypes';

// Validation programs one file may build, per pass, before the assertions
// still unproven are kept.
const maxValidationPrograms = 24;

/** An assertion to drop, and the text edit that drops it. */
interface Candidate {
  node: ts.AsExpression;
  change: TextChange;
}

/**
 * Retries the `as any` assertions add-conversions inserted.
 *
 * Each one records a property access or unknown value the checker could not
 * resolve on migration day, and nothing reconsiders it afterwards. Once
 * `@types` land or a neighboring directory migrates, some of them check clean
 * without the cast.
 *
 * An assertion is dropped only when re-checking the file without it produces
 * no error the file did not already have. Removing an assertion to `any`
 * narrows the expression to the operand's real type rather than widening it,
 * so a removal that mattered brings back the diagnostic that motivated the
 * cast instead of passing silently.
 *
 * An assertion the file still needs is then retyped where the checker can name
 * something tighter than `any` for it, so `f(raw as any)` reads `f(raw as
 * Opts)` and the rest of the expression keeps its checking instead of being
 * poisoned by `any`. A retype is kept only when the file re-checks clean with
 * it in place and the expression it covers is no longer `any`.
 *
 * Only the tool's own output is in scope: `as any`, and an assertion to a type
 * alias declared as `any`. A user written `as SomeType` is left alone.
 */
const retryConversionsPlugin: Plugin = {
  name: 'retry-conversions',

  run(params) {
    const { fileName, sourceFile, getLanguageService } = params;
    const { text } = sourceFile;
    const assertions = collectAssertions(sourceFile);
    if (assertions.length === 0) {
      return text;
    }

    const program = getLanguageService().getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== text) {
      return text;
    }

    const checker = program.getTypeChecker();
    const inScope = assertions.filter((node) => isAnyType(node.type, checker));
    if (inScope.length === 0) {
      return text;
    }
    const candidates = inScope.map((node) => ({
      node,
      change: removalChange(node, sourceFile, inScope),
    }));

    let changes: TextChange[];
    try {
      changes = retriedChanges(
        fileName,
        text,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
        program,
        (node) => narrowingChanges(checker, node, sourceFile),
      );
    } catch (e) {
      fileNoticeReporter(params, '[retry-conversions]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: 'The assertions in this file are kept.',
      });
      return text;
    }

    return applyTextChanges(text, changes);
  },
};

export default retryConversionsPlugin;

/** Assertions whose type is `any` or could name an alias for it. */
function collectAssertions(sourceFile: ts.SourceFile): ts.AsExpression[] {
  const assertions: ts.AsExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && isAnyOrAliasReference(node.type)) {
      assertions.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return assertions;
}

/**
 * Deletes the assertion from the source text, so everything it wrapped is
 * restored from the original bytes rather than reprinted: add-conversions
 * inserted these by replacing whole enclosing statements, and reprinting one
 * would reformat the untouched code around it.
 *
 * Parentheses the assertion needed are dropped with it where the operand
 * stands alone in every position, which is where `(x as any).y` came from.
 */
function removalChange(
  node: ts.AsExpression,
  sourceFile: ts.SourceFile,
  assertions: ts.AsExpression[],
): TextChange {
  const operand = node.expression;
  const { parent } = node;
  if (
    ts.isParenthesizedExpression(parent) &&
    !ts.isNewExpression(parent.parent) &&
    parent.getStart(sourceFile) + 1 === node.getStart(sourceFile) &&
    node.end === parent.end - 1 &&
    standsAlone(operand) &&
    // An assertion inside the operand edits a span this one would rewrite.
    !assertions.some(
      (other) =>
        other !== node &&
        other.getStart(sourceFile) >= operand.getStart(sourceFile) &&
        other.end <= operand.end,
    )
  ) {
    const start = parent.getStart(sourceFile);
    return {
      start,
      length: parent.end - start,
      text: sourceFile.text.slice(operand.getStart(sourceFile), operand.end),
    };
  }
  return { start: operand.end, length: node.end - operand.end, text: '' };
}

/** Expressions that never need parentheses, wherever the assertion sat. */
function standsAlone(node: ts.Expression): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.ThisKeyword:
      return true;
    case ts.SyntaxKind.PropertyAccessExpression:
    case ts.SyntaxKind.ElementAccessExpression:
    case ts.SyntaxKind.CallExpression:
    case ts.SyntaxKind.NonNullExpression:
      // Parentheses end an optional chain, so dropping them would change what
      // the rest of the expression short-circuits over.
      return !isOptionalChain(node);
    default:
      return false;
  }
}

function isOptionalChain(node: ts.Expression): boolean {
  if (ts.isNonNullExpression(node)) {
    return isOptionalChain(node.expression);
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  ) {
    return node.questionDotToken != null || isOptionalChain(node.expression);
  }
  return false;
}

/**
 * The replacement types for one assertion, in the order they are tried: what
 * the operand is, then what the position expects.
 *
 * The operand's type is the tightest thing the checker already knows, so it
 * claims the least and goes first. The contextual type is a claim about what
 * the surrounding code needs, which is worth writing where nothing else names
 * the type and is sound only because an unrelated conversion is itself an
 * error and the file is re-checked with the assertion in place.
 */
function narrowingChanges(
  checker: ts.TypeChecker,
  node: ts.AsExpression,
  sourceFile: ts.SourceFile,
): TextChange[] {
  const start = node.type.getStart(sourceFile);
  const current = sourceFile.text.slice(start, node.type.end);
  const changes: TextChange[] = [];
  const types = [operandType(checker, node.expression), checker.getContextualType(node)];
  types.forEach((type) => {
    if (!type) return;
    const printed = printType(checker, type, node);
    if (!printed.printable || printed.text === current) return;
    if (changes.some((change) => change.text === printed.text)) return;
    changes.push({ start, length: node.type.end - start, text: printed.text });
  });
  return changes;
}

/**
 * The operand's type with null and undefined dropped. An assertion that is
 * still doing work is one the file reads or passes the value through, and the
 * nullable type is what dropping the assertion just failed on, so the union
 * as it stands would only restate that failure.
 */
function operandType(checker: ts.TypeChecker, operand: ts.Expression): ts.Type {
  const type = checker.getTypeAtLocation(operand);
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
    return type;
  }
  return checker.getNonNullableType(type);
}

/**
 * The edits the file checks with. Removal is proven first, so an assertion
 * that can go entirely is never retyped instead, and the narrowings are then
 * proven on top of the removals that were kept.
 *
 * Each pass tries the whole set first, which is one program for a file whose
 * casts have all gone stale; otherwise each edit is retried on top of what is
 * already proven, so a set is only kept when the file checks with every member
 * of it applied at once.
 */
function retriedChanges(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
  narrowingsFor: (node: ts.AsExpression) => TextChange[],
): TextChange[] {
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
  let programsLeft = maxValidationPrograms;

  // `retyped` holds the ends, in the original text, of the assertions the
  // group gives a new type to.
  const checksClean = (changes: TextChange[], retyped: number[]): boolean => {
    if (programsLeft <= 0) return false;
    programsLeft -= 1;
    const sorted = [...changes].sort((a, b) => a.start - b.start);
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, sorted),
      compilerOptions,
      projectProgram,
    );
    if (findNewErrors(baseline, candidate, sorted, fileName).length > 0) return false;
    return retyped.every((end) => isNarrowed(candidate, fileName, toCandidatePos(end, sorted)));
  };

  const removals = candidates.map((candidate) => candidate.change);
  if (checksClean(removals, [])) {
    return removals;
  }

  const accepted: TextChange[] = [];
  const kept: Candidate[] = [];
  candidates.forEach((candidate) => {
    if (checksClean([...accepted, candidate.change], [])) {
      accepted.push(candidate.change);
    } else {
      kept.push(candidate);
    }
  });

  programsLeft = maxValidationPrograms;
  const retyped: number[] = [];
  kept.forEach((candidate) => {
    const { end } = candidate.node;
    const change = narrowingsFor(candidate.node).find((narrowing) =>
      checksClean([...accepted, narrowing], [...retyped, end]),
    );
    if (change) {
      accepted.push(change);
      retyped.push(end);
    }
  });
  return accepted;
}

/**
 * Whether the assertion ending at `end` in the re-checked file is something
 * other than `any`. A name printed for one scope can resolve to a different
 * declaration in another, and a narrowing that lands back on `any` changed
 * nothing while introducing no error to fail on.
 */
function isNarrowed(service: ts.LanguageService, fileName: string, end: number): boolean {
  const program = service.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!program || !source) return false;
  const node = findAssertionEndingAt(source, end);
  if (!node) return false;
  return (program.getTypeChecker().getTypeAtLocation(node).flags & ts.TypeFlags.Any) === 0;
}

function findAssertionEndingAt(source: ts.SourceFile, end: number): ts.AsExpression | undefined {
  let found: ts.AsExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found || node.end < end || node.getStart(source) > end) return;
    if (ts.isAsExpression(node) && node.end === end) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return found;
}
