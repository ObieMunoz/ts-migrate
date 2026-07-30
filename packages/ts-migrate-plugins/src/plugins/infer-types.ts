import ts from 'typescript';
import { errorMessage, fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toOriginalPos,
} from '../utils/candidateValidation';
import {
  getInferenceChanges,
  inferableDiagnosticCodes,
  inferenceFormatSettings,
  LintConfig,
} from '../utils/inferFromUsage';

export type { LintConfig };

// Errors reported on the arguments of a call that no longer matches the
// callee's signature.
const callArgumentErrorCodes = new Set([2345, 2554, 2555, 2559, 2769]);

const bodyOnlySuffix = 'TsMigrateBodyOnly';

/**
 * Annotates implicit-any locations with types the TypeScript language
 * service can infer, so that only the truly undeterminable ones fall through
 * to the explicit-any plugin.
 *
 * The function body is treated as the source of truth for its contract:
 * annotations that would contradict the body are recomputed from body
 * evidence alone (hiding call sites from the inference engine), so improper
 * callers become type errors for ts-ignore to flag instead of widening the
 * signature. When body evidence is absent or self-contradictory, no
 * annotation is made.
 */
const inferTypesPlugin: Plugin = {
  name: 'infer-types',

  run(params, lintConfig?: LintConfig) {
    const { fileName, text, getLanguageService } = params;
    const languageService = getLanguageService();
    const projectOptions = languageService.getProgram()?.getCompilerOptions() ?? {};
    // Under noImplicitAny every inferable location is a semantic error
    // (cached on the program), so clean files are gated without a code-fix
    // pass. Without it the gate would need the suggestion scan (recomputed on
    // every call) that the code-fix pass performs internally anyway, so the
    // pass itself is the cheapest gate.
    const noImplicitAny = projectOptions.noImplicitAny ?? projectOptions.strict ?? false;
    if (noImplicitAny) {
      const hasInferableDiagnostics = languageService
        .getSemanticDiagnostics(fileName)
        .some((diagnostic) => inferableDiagnosticCodes.has(diagnostic.code));
      if (!hasInferableDiagnostics) {
        return undefined;
      }
    }

    const formatSettings = inferenceFormatSettings(lintConfig);

    try {
      const changes = getInferenceChanges(languageService, fileName, formatSettings, (error) =>
        fileNoticeReporter(params, '[infer-types]')({
          reason: `Could not write every type it inferred: ${firstLine(error)}`,
          hint: 'The rest were written; explicit-any fills in what is left.',
          recovered: true,
        }),
      );
      if (changes.length === 0) {
        return undefined;
      }

      const program = languageService.getProgram();
      const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});

      return withBodyWins(fileName, text, changes, compilerOptions, formatSettings, program);
    } catch (e) {
      fileNoticeReporter(params, '[infer-types]')({
        reason: firstLine(e),
        hint: 'The file keeps the annotations it had; explicit-any fills the rest in with any.',
      });
      return undefined;
    }
  },
};

export default inferTypesPlugin;

function firstLine(error: unknown): string {
  return errorMessage(error).split('\n')[0].trim();
}

function withBodyWins(
  fileName: string,
  text: string,
  changes: TextChange[],
  compilerOptions: ts.CompilerOptions,
  formatSettings: ts.FormatCodeSettings,
  projectProgram: ts.Program | undefined,
): string | undefined {
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
  const candidateText = applyTextChanges(text, changes);
  const candidate = createFileLanguageService(
    fileName,
    candidateText,
    compilerOptions,
    projectProgram,
  );

  const newErrors = findNewErrors(baseline, candidate, changes, fileName);
  if (newErrors.length === 0) {
    return candidateText;
  }

  const originalSource = getSourceFileOrThrow(baseline, fileName);

  const changesByFunction = new Map<ts.Node | null, TextChange[]>();
  changes.forEach((change) => {
    const fn = enclosingFunctionLike(originalSource, change.start);
    const group = changesByFunction.get(fn);
    if (group) {
      group.push(change);
    } else {
      changesByFunction.set(fn, [change]);
    }
  });

  const annotatedFns = new Set(changesByFunction.keys());
  const contested = attributeErrors(
    newErrors,
    candidate,
    fileName,
    changes,
    originalSource,
    annotatedFns,
  );

  // Hide call sites of contested functions from the inference engine so
  // their annotations are recomputed from body evidence alone.
  const bodyOnlyChanges = inferBodyOnly(
    [...contested].filter((fn): fn is ts.Node => fn != null && changesByFunction.has(fn)),
    baseline,
    fileName,
    text,
    compilerOptions,
    formatSettings,
    originalSource,
    projectProgram,
  );

  const assemble = (dropped: Set<ts.Node | null>): TextChange[] => {
    const result: TextChange[] = [];
    changesByFunction.forEach((group, fn) => {
      if (dropped.has(fn)) return;
      if (!contested.has(fn)) {
        result.push(...group);
      } else if (fn != null && bodyOnlyChanges.has(fn)) {
        result.push(...(bodyOnlyChanges.get(fn) as TextChange[]));
      }
    });
    return result.sort((a, b) => a.start - b.start);
  };

  let finalChanges = assemble(new Set());
  if (isNoOp(finalChanges)) {
    return undefined;
  }

  // assemble() returns the original set untouched when every contested scope
  // held no annotations (errors attributed to un-annotated functions or the
  // top level); the candidate service already validated exactly that text.
  const originalChanges = new Set(changes);
  const reassembled =
    finalChanges.length !== changes.length ||
    finalChanges.some((change) => !originalChanges.has(change));

  // Body-only annotations may still contradict the body (a TS expressiveness
  // limit); drop those rather than suppressing inside the function. When the
  // conflict is a call to one specific annotated parameter (e.g. a redux
  // dispatch inferred too narrowly from heterogeneous calls), only that
  // parameter's annotation is dropped.
  let finalText = reassembled ? applyTextChanges(text, finalChanges) : candidateText;
  const finalService = reassembled
    ? createFileLanguageService(fileName, finalText, compilerOptions, projectProgram)
    : candidate;
  const finalErrors = reassembled
    ? findNewErrors(baseline, finalService, finalChanges, fileName)
    : newErrors;
  const dropped = collectBodyConflictDrops(
    finalErrors,
    finalService,
    fileName,
    finalChanges,
    originalSource,
    annotatedFns,
  );
  if (dropped.size > 0) {
    finalChanges = finalChanges.filter((change) => !dropped.has(change));
    if (isNoOp(finalChanges)) {
      return undefined;
    }
    finalText = applyTextChanges(text, finalChanges);
  }

  return finalText;
}

function collectBodyConflictDrops(
  errors: ts.Diagnostic[],
  service: ts.LanguageService,
  fileName: string,
  finalChanges: TextChange[],
  originalSource: ts.SourceFile,
  annotatedFns: Set<ts.Node | null>,
): Set<TextChange> {
  const dropped = new Set<TextChange>();
  const program = service.getProgram();
  if (!program) return dropped;
  const source = program.getSourceFile(fileName);
  if (!source) return dropped;
  const checker = program.getTypeChecker();

  const dropWithin = (start: number, end: number) => {
    finalChanges.forEach((change) => {
      if (change.start >= start && change.start < end) {
        dropped.add(change);
      }
    });
  };

  errors.forEach((error) => {
    if (error.start == null) return;

    // A call that no longer matches an annotated *parameter* (e.g. a redux
    // dispatch inferred too narrowly from heterogeneous calls) is a conflict
    // of that parameter's annotation, wherever the call sits.
    if (callArgumentErrorCodes.has(error.code)) {
      const callee = calleeDeclarationAt(source, error.start, error.length ?? 0, checker);
      if (callee && ts.isParameter(callee) && callee.getSourceFile() === source) {
        const start = toOriginalPos(callee.getStart(), finalChanges);
        const end = toOriginalPos(callee.end, finalChanges);
        dropWithin(start, end + 1);
        return;
      }

      // When the callee doesn't resolve to an annotated in-file parameter
      // (an external function, or an in-file declaration like a `declare
      // function`), the argument at the error position may itself be an
      // annotated parameter — e.g. `showErr(dispatch)` where `dispatch` was
      // annotated. Drop just that argument's annotation rather than the
      // entire enclosing function.
      const argNode = argumentNodeAt(source, error.start);
      if (argNode && ts.isIdentifier(argNode)) {
        const argSymbol = checker.getSymbolAtLocation(argNode);
        const argDecl = argSymbol?.declarations?.[0];
        if (argDecl && ts.isParameter(argDecl) && argDecl.getSourceFile() === source) {
          const start = toOriginalPos(argDecl.getStart(), finalChanges);
          const end = toOriginalPos(argDecl.end, finalChanges);
          dropWithin(start, end + 1);
          return;
        }
      }
    }

    // The conflicting annotation may sit on any enclosing function (a
    // parameter of an outer thunk used inside a nested callback).
    const annotatedAncestors = ancestorFunctions(
      originalSource,
      toOriginalPos(error.start, finalChanges),
    ).filter((fn) => annotatedFns.has(fn));
    if (annotatedAncestors.length === 0) {
      // A mismatched call to an annotated function from elsewhere is the
      // expected way improper callers get flagged.
      return;
    }
    const outermost = annotatedAncestors[annotatedAncestors.length - 1];
    dropWithin(outermost.getStart(), outermost.end);
  });
  return dropped;
}

function inferBodyOnly(
  contestedFunctions: ts.Node[],
  baseline: ts.LanguageService,
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  formatSettings: ts.FormatCodeSettings,
  originalSource: ts.SourceFile,
  projectProgram: ts.Program | undefined,
): Map<ts.Node, TextChange[]> {
  const bodyOnlyChanges = new Map<ts.Node, TextChange[]>();
  if (contestedFunctions.length === 0) {
    return bodyOnlyChanges;
  }

  // In-file call sites are hidden by renaming the references; cross-file call
  // sites are already invisible to the single-file decoy service.
  const renames: TextChange[] = [];
  contestedFunctions.forEach((fn) => {
    const nameNode = bindingNameOf(fn);
    if (!nameNode) return;
    const referenced = baseline.findReferences(fileName, nameNode.getStart()) || [];
    referenced.forEach((symbol) => {
      symbol.references.forEach((reference) => {
        if (reference.fileName !== fileName) return;
        const { start } = reference.textSpan;
        // References inside the function (the declaration itself, recursive
        // calls) are body evidence and stay intact.
        if (start >= fn.getStart() && start < fn.end) return;
        renames.push({ start: start + reference.textSpan.length, length: 0, text: bodyOnlySuffix });
      });
    });
  });
  renames.sort((a, b) => a.start - b.start);

  const decoyText = applyTextChanges(text, renames);
  const decoy = createFileLanguageService(fileName, decoyText, compilerOptions, projectProgram);
  let decoyChanges: TextChange[] = [];
  try {
    // Nothing to report from here: the decoy is an implementation detail of
    // the attribution below, and the pass over the real service has already
    // said whatever there was to say about this file.
    decoyChanges = getInferenceChanges(decoy, fileName, formatSettings, () => {});
  } catch {
    // The decoy only refines which changes count as body evidence. Letting it
    // throw would discard the inferences the real service already produced,
    // which costs more than the attribution it buys.
  }
  decoyChanges.forEach((change) => {
    const originalStart = toOriginalPos(change.start, renames);
    const fn = enclosingFunctionLike(originalSource, originalStart);
    if (fn == null || !contestedFunctions.includes(fn)) return;
    const group = bodyOnlyChanges.get(fn);
    const mapped = { ...change, start: originalStart };
    if (group) {
      group.push(mapped);
    } else {
      bodyOnlyChanges.set(fn, [mapped]);
    }
  });
  return bodyOnlyChanges;
}

function attributeErrors(
  errors: ts.Diagnostic[],
  service: ts.LanguageService,
  fileName: string,
  changes: TextChange[],
  originalSource: ts.SourceFile,
  annotatedFns: Set<ts.Node | null>,
): Set<ts.Node | null> {
  const attributed = new Set<ts.Node | null>();
  const program = service.getProgram();
  if (!program) return attributed;
  const source = program.getSourceFile(fileName);
  if (!source) return attributed;
  const checker = program.getTypeChecker();

  errors.forEach((error) => {
    if (error.start == null) return;

    // A bad call to an annotated *parameter* (e.g. a redux dispatch) is a
    // conflict of the function owning that parameter.
    if (callArgumentErrorCodes.has(error.code)) {
      const callee = calleeDeclarationAt(source, error.start, error.length ?? 0, checker);
      if (callee && ts.isParameter(callee) && callee.getSourceFile() === source) {
        const owner = enclosingFunctionLike(
          originalSource,
          toOriginalPos(callee.getStart(), changes),
        );
        if (owner != null && annotatedFns.has(owner)) {
          attributed.add(owner);
          return;
        }
      }
    }

    // Any other new error inside annotated functions contests them all — the
    // conflicting annotation may sit on an outer function's parameter used
    // inside a nested callback.
    const annotatedAncestors = ancestorFunctions(
      originalSource,
      toOriginalPos(error.start, changes),
    ).filter((fn) => annotatedFns.has(fn));
    if (annotatedAncestors.length > 0) {
      annotatedAncestors.forEach((fn) => attributed.add(fn));
      return;
    }

    if (callArgumentErrorCodes.has(error.code)) {
      const callee = calleeDeclarationAt(source, error.start, error.length ?? 0, checker);
      if (callee && callee.getSourceFile() === source) {
        const originalFn = enclosingFunctionLike(
          originalSource,
          toOriginalPos(callee.getStart(), changes),
        );
        if (originalFn != null) {
          attributed.add(originalFn);
          return;
        }
      }
    }

    attributed.add(enclosingFunctionLike(originalSource, toOriginalPos(error.start, changes)));
  });
  return attributed;
}

function calleeDeclarationAt(
  source: ts.SourceFile,
  start: number,
  length: number,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  // The node covering the whole error span disambiguates which call the
  // diagnostic blames: argument-mismatch spans (TS2345) cover the argument
  // expression - which may itself be a nested call whose callee identifier
  // starts at the same position - while arity spans (TS2554/2555) cover just
  // the callee expression. Walking up from that node, the violated call is
  // the first one holding it as its callee or as a direct argument.
  let node = nodeSpanning(source, start, start + length);
  while (node) {
    const parent: ts.Node | undefined = node.parent;
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
      const isCallee = parent.expression === node;
      const isArgument = parent.arguments != null && parent.arguments.some((a) => a === node);
      if (isCallee || isArgument) {
        node = parent;
        break;
      }
    }
    node = parent;
  }
  if (!node) return undefined;
  const symbol = checker.getSymbolAtLocation((node as ts.CallExpression).expression);
  const declaration = symbol && symbol.declarations && symbol.declarations[0];
  if (!declaration) return undefined;
  // A function assigned to a variable resolves to the variable declaration.
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    return declaration.initializer;
  }
  return declaration;
}

// Innermost node covering the whole span; equals nodeAt for empty spans.
function nodeSpanning(source: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  const spanEnd = Math.max(end, start + 1);
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (node.getStart() <= start && spanEnd <= node.end) {
      result = node;
      node.forEachChild(visit);
    }
  };
  source.forEachChild(visit);
  return result;
}

function bindingNameOf(fn: ts.Node): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(fn) && fn.name) {
    return fn.name;
  }
  if (
    (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return fn.parent.name;
  }
  if (
    (ts.isMethodDeclaration(fn) ||
      ts.isGetAccessorDeclaration(fn) ||
      ts.isSetAccessorDeclaration(fn)) &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name;
  }
  return undefined;
}

function isFunctionLikeWithBody(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function enclosingFunctionLike(source: ts.SourceFile, position: number): ts.Node | null {
  const ancestors = ancestorFunctions(source, position);
  return ancestors.length > 0 ? ancestors[0] : null;
}

// Enclosing function-likes at a position, innermost first.
function ancestorFunctions(source: ts.SourceFile, position: number): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (node.getStart() <= position && position < node.end) {
      if (isFunctionLikeWithBody(node)) {
        result.unshift(node);
      }
      node.forEachChild(visit);
    }
  };
  source.forEachChild(visit);
  return result;
}

function nodeAt(source: ts.SourceFile, position: number): ts.Node | undefined {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (node.getStart() <= position && position < node.end) {
      result = node;
      node.forEachChild(visit);
    }
  };
  source.forEachChild(visit);
  return result;
}

// Returns the direct argument node that contains `position` within a
// CallExpression/NewExpression, or undefined if the position is not inside
// an argument list.
function argumentNodeAt(source: ts.SourceFile, position: number): ts.Node | undefined {
  let node = nodeAt(source, position);
  while (node) {
    const parent = node.parent;
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
      if (parent.arguments && parent.arguments.some((a) => a === node)) {
        return node;
      }
    }
    node = node.parent;
  }
  return undefined;
}

function isNoOp(changes: TextChange[]): boolean {
  // Parenthesizing an arrow parameter whose annotation was dropped is not
  // worth a diff on its own.
  return changes.every((change) => change.length === 0 && /^[()]$/.test(change.text));
}

function getSourceFileOrThrow(service: ts.LanguageService, fileName: string): ts.SourceFile {
  const program = service.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!source) {
    throw new Error(`Failed to load source file: ${fileName}`);
  }
  return source;
}
