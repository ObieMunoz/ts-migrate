import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';

// Validation programs one file may build before the assertions still unproven
// are kept.
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
    const inScope = assertions.filter((node) => isAnyAssertion(node.type, checker));
    if (inScope.length === 0) {
      return text;
    }
    const candidates = inScope.map((node) => ({
      node,
      change: removalChange(node, sourceFile, inScope),
    }));

    let removable: Candidate[];
    try {
      removable = removableCandidates(
        fileName,
        text,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
        program,
      );
    } catch (e) {
      fileNoticeReporter(params, '[retry-conversions]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: 'The assertions in this file are kept.',
      });
      return text;
    }

    return applyTextChanges(
      text,
      removable.map((candidate) => candidate.change),
    );
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

function isAnyOrAliasReference(typeNode: ts.TypeNode): boolean {
  return (
    typeNode.kind === ts.SyntaxKind.AnyKeyword ||
    (ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeArguments == null)
  );
}

/**
 * Whether the asserted type is the one add-conversions writes: `any`, or the
 * alias it takes from config, read here as any alias the project declares as
 * `any` rather than as a hardcoded name.
 */
function isAnyAssertion(typeNode: ts.TypeNode, checker: ts.TypeChecker): boolean {
  if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
    return true;
  }
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(typeNode.typeName);
  return (symbol?.declarations ?? []).some(
    (declaration) =>
      ts.isTypeAliasDeclaration(declaration) && declaration.type.kind === ts.SyntaxKind.AnyKeyword,
  );
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
 * The assertions the file checks without. The whole set is tried first, which
 * is one program for a file whose casts have all gone stale; otherwise each
 * one is retried on top of what is already proven, so a set is only kept when
 * the file checks with every member of it removed at once.
 */
function removableCandidates(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): Candidate[] {
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
  let programsLeft = maxValidationPrograms;

  const checksClean = (group: Candidate[]): boolean => {
    if (programsLeft <= 0) return false;
    programsLeft -= 1;
    const changes = group.map((candidate) => candidate.change).sort((a, b) => a.start - b.start);
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
      projectProgram,
    );
    return findNewErrors(baseline, candidate, changes, fileName).length === 0;
  };

  if (checksClean(candidates)) {
    return candidates;
  }

  const removable: Candidate[] = [];
  candidates.forEach((candidate) => {
    if (checksClean([...removable, candidate])) {
      removable.push(candidate);
    }
  });
  return removable;
}
