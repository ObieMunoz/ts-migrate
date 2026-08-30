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
import { findNodeEndingAt } from '../utils/enclosingNode';
import {
  getInferenceChanges,
  inferenceFormatSettings,
  InferredImport,
} from '../utils/inferFromUsage';
import { withImportChanges } from './utils/annotationImports';
import { isAnyOrAliasReference, isAnyType } from './utils/anyTypes';

// Validation programs one file may build, per pass, before the annotations
// still unproven are kept.
const maxValidationPrograms = 24;

// How far into a type the search for an empty member follows element types and
// union members.
const maxTypeDepth = 4;

/**
 * The widest annotation worth writing into a diff, and it has to be one line.
 *
 * A readability bound, not a correctness one: the engine will happily print the
 * whole structural shape of a parameter, comments from the source type included,
 * and several hundred characters of inline object type is a worse thing to leave
 * in a maintained file than the `any` it replaced. Set above the widest thing a
 * migrate run was measured writing on the benchmark projects, so this refuses
 * only what would have been an outlier there too.
 */
const maxAnnotationLength = 120;

/**
 * What the checker answers when it has nothing to say about a declaration.
 *
 * `any` is the implicit one, `never` the element type of an empty array literal
 * under strictNullChecks — the inference engine prints both and infer-types
 * rewrites both back to `any`. `null`, `undefined` and `void` are what it prints
 * where the only evidence it found was an argument nothing was passed for, and
 * an annotation of one rejects every real value the declaration ever holds,
 * which is strictly worse than the `any` being retried.
 */
const emptyTypeFlags =
  ts.TypeFlags.Any |
  ts.TypeFlags.Never |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void;

/** The declarations the inference engine writes types for. */
type RetryableDeclaration =
  | ts.ParameterDeclaration
  | ts.VariableDeclaration
  | ts.PropertyDeclaration;

/** An annotation to retry, in the positions of the original text. */
interface Candidate {
  declaration: RetryableDeclaration;
  /** End of the name the declaration binds, where its type is looked up again. */
  nameEnd: number;
  /** Start of the `:` the annotation opens with, which is also where a new one goes. */
  start: number;
  /** End of the annotated type. */
  end: number;
}

/** A candidate and the edit that retries it: a new annotation, or none at all. */
interface Proposal {
  candidate: Candidate;
  change: TextChange;
}

/**
 * Re-infers the `any` annotations an earlier ts-migrate run wrote.
 *
 * Each one records a type the checker could not work out on migration day, and
 * nothing reconsiders it afterwards. `reignore` refreshes the suppression
 * comments; the annotations are permanent, and the annotation is itself what
 * keeps them that way, since every diagnostic the inference engine acts on is
 * an implicit-any one, reported only where the declaration carries no type.
 *
 * So each one is stripped and the engine asked again. Once `@types` land, a
 * neighboring directory migrates, or a CommonJS module becomes an ESM one,
 * some of those declarations have real types waiting for them.
 *
 * A strip is kept only when re-checking the file produces no error it did not
 * already have *and* the checker then answers something for the declaration
 * (see `saysNothing`). That second half is what does the work: removing an
 * annotation introduces no error of its own, so a declaration left implicitly
 * any would otherwise read as proven. A replacement also has to be worth
 * writing (see `isWorthWriting`). Everything else is restored byte for byte.
 *
 * Only the tool's own output is in scope: `any`, `any[]`, and an alias the
 * project declares as `any`. A user written annotation is left alone.
 */
const retryAnnotationsPlugin: Plugin = {
  name: 'retry-annotations',

  run(params) {
    const { fileName, sourceFile, getLanguageService } = params;
    const { text } = sourceFile;
    const annotated = collectAnnotated(sourceFile);
    if (annotated.length === 0) {
      return text;
    }

    const program = getLanguageService().getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== text) {
      return text;
    }

    const checker = program.getTypeChecker();
    const candidates = annotated.filter(({ declaration }) =>
      isAnyType(annotatedType(declaration.type as ts.TypeNode), checker),
    );
    if (candidates.length === 0) {
      return text;
    }

    let changes: TextChange[];
    try {
      changes = retriedChanges(
        fileName,
        text,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
        program,
      );
    } catch (e) {
      fileNoticeReporter(params, '[retry-annotations]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: 'The annotations in this file are kept.',
      });
      return text;
    }

    return applyTextChanges(text, changes);
  },
};

export default retryAnnotationsPlugin;

/**
 * Every annotation a retry could act on, in source order.
 *
 * Type positions are all left out, parameters of a function type with them: an
 * annotation there is the only thing saying what the type is, so a strip would
 * be restored a program later. The checker is not consulted yet, so this is the
 * syntactic half of the filter and `run` applies the rest.
 */
function collectAnnotated(sourceFile: ts.SourceFile): Candidate[] {
  const candidates: Candidate[] = [];
  const visit = (node: ts.Node): void => {
    const candidate = candidateOf(node);
    if (candidate) candidates.push(candidate);
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return candidates;
}

function candidateOf(node: ts.Node): Candidate | undefined {
  if (!isRetryableDeclaration(node) || node.type == null || !ts.isIdentifier(node.name)) {
    return undefined;
  }
  // A `this` parameter exists only to carry an annotation, and an ambient
  // declaration has no body or initializer for anything to be inferred from.
  if (ts.isParameter(node) && node.name.text === 'this') return undefined;
  if ((ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient) !== 0) return undefined;
  // A parameter of a function type or a signature, whose enclosing declaration
  // has no body to read evidence from.
  if (ts.isParameter(node) && (node.parent as ts.FunctionLikeDeclaration).body == null) {
    return undefined;
  }
  if (!isAnyOrAliasReference(annotatedType(node.type))) return undefined;

  return {
    declaration: node,
    nameEnd: node.name.end,
    // `name` `?` `:` `type` is the order in the source, so the annotation runs
    // from the end of whatever the name is allowed to be followed by. Taking
    // the whole span rather than the type node keeps a strip from leaving the
    // colon behind, and a replacement from having to reproduce the spacing.
    start: (questionOrExclamationToken(node) ?? node.name).end,
    end: node.type.end,
  };
}

function questionOrExclamationToken(node: RetryableDeclaration): ts.Node | undefined {
  if (ts.isVariableDeclaration(node)) return node.exclamationToken;
  if (ts.isParameter(node)) return node.questionToken;
  return node.questionToken ?? node.exclamationToken;
}

/** The annotation, with `...args: any[]` read as an array of one. */
function annotatedType(type: ts.TypeNode): ts.TypeNode {
  return ts.isArrayTypeNode(type) ? type.elementType : type;
}

function isRetryableDeclaration(node: ts.Node | undefined): node is RetryableDeclaration {
  return (
    node != null &&
    (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node))
  );
}

/**
 * Whether the declaration would still have a type of its own with the
 * annotation gone, which is what makes a plain removal worth a program.
 *
 * A parameter or variable with nothing to infer from is an implicit any the
 * moment the annotation goes, and it is the commonest candidate there is, so
 * checking one costs a program per file to be refused every time. A class
 * property is not on that list: a bare one takes its type from what the
 * constructor assigns, which is where declare-missing-class-properties leaves
 * the ones it can.
 */
function typedWithoutAnnotation(declaration: RetryableDeclaration): boolean {
  return ts.isPropertyDeclaration(declaration) || declaration.initializer != null;
}

/**
 * The edits the file checks with. Each pass tries the whole set first, which is
 * one program for a file whose annotations have all gone stale; otherwise each
 * edit is retried on top of what is already proven, so a set is only kept when
 * the file checks with every member of it applied at once.
 */
function retriedChanges(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): TextChange[] {
  const { annotations, imports } = inferredAnnotations(
    fileName,
    text,
    compilerOptions,
    candidates,
    projectProgram,
  );
  const proposals: Proposal[] = [];
  candidates.forEach((candidate) => {
    const annotation = annotations.get(candidate.start);
    if (annotation === undefined && !typedWithoutAnnotation(candidate.declaration)) return;
    proposals.push({
      candidate,
      change: {
        start: candidate.start,
        length: candidate.end - candidate.start,
        text: annotation ?? '',
      },
    });
  });
  if (proposals.length === 0) {
    return [];
  }

  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
  let programsLeft = maxValidationPrograms;

  // A retried annotation may name a type the file no longer imports, since
  // the annotation it replaces was the reason nothing did. The import goes in
  // with the group it belongs to, so a group is judged as it would be written.
  const withImports = (group: Proposal[]): TextChange[] =>
    withImportChanges(
      fileName,
      text,
      group.map(({ change }) => change),
      imports,
    );

  const checksClean = (group: Proposal[]): boolean => {
    if (programsLeft <= 0) return false;
    programsLeft -= 1;
    const changes = withImports(group);
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
      projectProgram,
    );
    if (findNewErrors(baseline, candidate, changes, fileName).length > 0) return false;
    return group.every(({ candidate: retried }) =>
      isTyped(candidate, fileName, toCandidatePos(retried.nameEnd, changes)),
    );
  };

  if (checksClean(proposals)) {
    return withImports(proposals);
  }

  const accepted: Proposal[] = [];
  proposals.forEach((proposal) => {
    if (checksClean([...accepted, proposal])) accepted.push(proposal);
  });
  return accepted.length > 0 ? withImports(accepted) : [];
}

/**
 * What the inference engine writes for each candidate once every candidate's
 * annotation is out of its way, keyed by where the candidate sits in the
 * original text.
 *
 * Positions the engine annotates that no candidate asked about are dropped.
 * Writing a type for a declaration that never had one is the migration's job,
 * and doing it here would put a new annotation in a diff that is supposed to be
 * a reduction.
 *
 * The imports come back whole rather than per candidate: they are written
 * against the file the accepted annotations produce, which drops the ones no
 * annotation kept ended up naming.
 */
function inferredAnnotations(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): { annotations: Map<number, string>; imports: InferredImport[] } {
  const strips: TextChange[] = candidates.map((candidate) => ({
    start: candidate.start,
    length: candidate.end - candidate.start,
    text: '',
  }));
  const stripped = createFileLanguageService(
    fileName,
    applyTextChanges(text, strips),
    compilerOptions,
    projectProgram,
  );
  // Nothing to report from a partial answer: a type the engine cannot print is
  // one more annotation this file keeps, which is the state it is already in.
  const inference = getInferenceChanges(stripped, fileName, inferenceFormatSettings(), () => {});

  const byPosition = new Map(inference.annotations.map((change) => [change.start, change.text]));
  const annotations = new Map<number, string>();
  candidates.forEach((candidate) => {
    const annotation = byPosition.get(toCandidatePos(candidate.start, strips));
    if (annotation !== undefined && isWorthWriting(annotation)) {
      annotations.set(candidate.start, annotation);
    }
  });
  return { annotations, imports: inference.imports };
}

/**
 * Whether the annotation is one worth putting in the file, on two counts.
 *
 * It has to fit (see `maxAnnotationLength`), and it must not hold more `any`
 * than the annotation it replaces, which always holds exactly one. Trading
 * `callback: any` for `callback: (arg0: any, arg1: any) => any` says a little
 * more about the value and triples the file's `any` count while doing it, which
 * `ts-migrate check` reads as debt growth and fails a build over. A command that
 * reports a reduction must not spend the metric it reports.
 */
function isWorthWriting(annotation: string): boolean {
  return (
    annotation.length <= maxAnnotationLength &&
    !annotation.includes('\n') &&
    anyKeywordCount(annotation) <= 1
  );
}

/**
 * `any` keywords in the annotation, counted with a scanner so an `any` inside a
 * string literal type is not one. A property whose name is `any` is counted,
 * since the scanner has no parser to tell it apart; that errs toward keeping the
 * annotation the file already has.
 */
function anyKeywordCount(annotation: string): number {
  if (!annotation.includes('any')) return 0;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.Standard,
    annotation,
  );
  let count = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.AnyKeyword) count += 1;
  }
  return count;
}

/**
 * Whether the declaration named at `nameEnd` in the re-checked file now has a
 * type the checker knows something about. A name printed for one scope can
 * resolve to a different declaration in another, and an annotation the engine
 * could not improve on lands back where it started while introducing no error
 * to fail on.
 */
function isTyped(service: ts.LanguageService, fileName: string, nameEnd: number): boolean {
  const program = service.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!program || !source) return false;
  const name = findNodeEndingAt(source, nameEnd, isRetryableDeclarationName);
  if (!name) return false;
  const checker = program.getTypeChecker();
  return !saysNothing(checker, checker.getTypeAtLocation(name), 0, new Set());
}

function isRetryableDeclarationName(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && isRetryableDeclaration(node.parent) && node.parent.name === node;
}

/**
 * Whether the type says nothing the annotation did not already say. The top
 * level is not enough: `let items: any = []` with the annotation gone is
 * `any[]`, or `never[]` under strictNullChecks, and both are the same debt
 * spelled implicitly.
 */
function saysNothing(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth: number,
  seen: Set<ts.Type>,
): boolean {
  if ((type.flags & emptyTypeFlags) !== 0) return true;
  if (depth >= maxTypeDepth || seen.has(type)) return false;
  seen.add(type);
  // Every member of a union has to be empty for the union to be: `string | null`
  // is a type worth writing where `null | undefined` is not.
  if (type.isUnion()) {
    return type.types.every((part) => saysNothing(checker, part, depth + 1, seen));
  }
  // An array of nothing rejects every element added to it later, which is the
  // array spelling of the same problem.
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  return element != null && saysNothing(checker, element, depth + 1, seen);
}
