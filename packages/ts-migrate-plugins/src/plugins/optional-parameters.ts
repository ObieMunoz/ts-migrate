import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import { contestedSpans, isOverloaded } from './utils/signature-relaxation';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';
import { isMigratableFile } from '../utils/sourceFiles';

// Expected {0} arguments, but got {1}.
const ARGUMENT_ARITY = 2554;

interface PlannedFile {
  /** The text the plan was computed against; a file that has since changed is skipped. */
  text: string;
  changes: TextChange[];
}

interface Pass {
  files: Map<string, PlannedFile>;
  /** Every file the plan was computed over, so a pass over a different set is noticed. */
  known: Set<string>;
  served: Set<string>;
}

let currentPass: Pass | undefined;

/**
 * Marks a parameter optional where the project already calls the function
 * without it.
 *
 * JavaScript has no arity checking, so a parameter a caller leaves off was
 * always optional; the declaration a migration produces is what makes it
 * required. Every such call is then an error, and one missing `?` can cost a
 * suppression at a hundred call sites. The evidence is the calls themselves:
 * a parameter is marked optional only from the position the fewest arguments
 * any call passes, and only when the file it is declared in gains no new
 * error from the change.
 *
 * The plan is computed once for the whole project, because the calls are in
 * files other than the one that declares the function.
 */
const optionalParametersPlugin: Plugin = {
  name: 'optional-parameters',

  run({ fileName, text, sourceFile, getLanguageService }) {
    const languageService = getLanguageService();
    if (!currentPass || currentPass.served.has(fileName) || !currentPass.known.has(fileName)) {
      currentPass = plan(languageService);
    }
    currentPass.served.add(fileName);

    const planned = currentPass.files.get(fileName);
    if (!planned || planned.text !== text) {
      return undefined;
    }
    return applyProven(fileName, text, sourceFile, planned.changes, languageService);
  },
};

export default optionalParametersPlugin;

function plan(languageService: ts.LanguageService): Pass {
  const pass: Pass = { files: new Map(), known: new Set(), served: new Set() };
  const program = languageService.getProgram();
  if (!program) return pass;
  const checker = program.getTypeChecker();

  const fewestArguments = new Map<ts.SignatureDeclaration, number>();
  program.getSourceFiles().forEach((file) => {
    if (!isMigratableFile(file)) return;
    pass.known.add(file.fileName);
    languageService.getSemanticDiagnostics(file.fileName).forEach((diagnostic) => {
      if (diagnostic.code !== ARGUMENT_ARITY || diagnostic.start == null) return;
      const call = callAt(file, diagnostic.start, diagnostic.length ?? 0);
      if (!call) return;
      const declaration = relaxableDeclaration(call, checker);
      if (!declaration) return;
      const provided = call.arguments?.length ?? 0;
      if (provided >= declaration.parameters.length) return;
      const fewest = fewestArguments.get(declaration);
      if (fewest === undefined || provided < fewest) {
        fewestArguments.set(declaration, provided);
      }
    });
  });

  const changesByFile = new Map<string, TextChange[]>();
  fewestArguments.forEach((provided, declaration) => {
    const changes = optionalMarkers(declaration, provided);
    if (changes.length === 0) return;
    const { fileName } = declaration.getSourceFile();
    const forFile = changesByFile.get(fileName);
    if (forFile) {
      forFile.push(...changes);
    } else {
      changesByFile.set(fileName, changes);
    }
  });

  changesByFile.forEach((changes, fileName) => {
    const source = program.getSourceFile(fileName);
    if (!source) return;
    pass.files.set(fileName, {
      text: source.text,
      changes: changes.sort((a, b) => a.start - b.start),
    });
  });
  return pass;
}

/** The call the arity diagnostic blames: its span covers the callee expression. */
function callAt(
  file: ts.SourceFile,
  start: number,
  length: number,
): ts.CallExpression | ts.NewExpression | undefined {
  let spanning: ts.Node | undefined = getTokenAtPosition(file, start);
  const end = start + length;
  while (spanning && spanning.end < end) {
    spanning = spanning.parent;
  }
  for (let node = spanning; node; node = node.parent) {
    const { parent } = node;
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
      if (parent.expression === node) return parent;
    }
  }
  // A span covering the call itself rather than its callee, as `new` gets.
  for (let node = spanning; node; node = node.parent) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return node;
  }
  return undefined;
}

/**
 * The signature declaration a call resolves to, when its parameters are ours
 * to relax. Overloads are left alone: the arity a caller misses may belong to
 * a signature other than the one the checker picked.
 */
function relaxableDeclaration(
  call: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
): ts.SignatureDeclaration | undefined {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.declaration;
  if (!declaration || ts.isJSDocSignature(declaration)) return undefined;
  // A signature with no body is a contract some other declaration has to
  // keep, so relaxing it says nothing about what that declaration accepts.
  if (!(declaration as ts.FunctionLikeDeclaration).body) return undefined;
  if (!isMigratableFile(declaration.getSourceFile())) return undefined;
  if (isOverloaded(declaration, checker)) return undefined;
  return declaration;
}

/**
 * A `?` for each parameter from the position the fewest arguments reach.
 * Nothing at all when one of them is a binding pattern, which TypeScript
 * refuses to make optional (TS2463): relaxing only the parameters after it
 * would leave the calls erroring anyway.
 */
function optionalMarkers(declaration: ts.SignatureDeclaration, provided: number): TextChange[] {
  const { parameters } = declaration;
  const first = parameters[0];
  if (first && ts.isIdentifier(first.name) && first.name.escapedText === 'this') return [];

  const changes: TextChange[] = [];
  for (let i = provided; i < parameters.length; i += 1) {
    const parameter = parameters[i];
    if (parameter.dotDotDotToken || parameter.questionToken || parameter.initializer) continue;
    if (!ts.isIdentifier(parameter.name)) return [];
    changes.push({ start: parameter.name.end, length: 0, text: '?' });
  }
  return changes;
}

/**
 * The file's text with the markers that cost it nothing. A marker widens the
 * parameter to `T | undefined` inside the body, which an annotation more
 * specific than `any` can contradict; those are dropped and the rest kept.
 */
function applyProven(
  fileName: string,
  text: string,
  sourceFile: ts.SourceFile,
  changes: TextChange[],
  languageService: ts.LanguageService,
): string | undefined {
  const program = languageService.getProgram();
  const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});
  const baseline = createFileLanguageService(fileName, text, compilerOptions, program);

  let kept = changes;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateText = applyTextChanges(text, kept);
    const candidate = createFileLanguageService(fileName, candidateText, compilerOptions, program);
    const newErrors = findNewErrors(baseline, candidate, kept, fileName);
    if (newErrors.length === 0) return candidateText;

    const contested = contestedSpans(newErrors, kept, sourceFile);
    const remaining = kept.filter(
      (change) => !contested.some(({ pos, end }) => change.start >= pos && change.start <= end),
    );
    if (remaining.length === kept.length || remaining.length === 0) return undefined;
    kept = remaining;
  }
  return undefined;
}
