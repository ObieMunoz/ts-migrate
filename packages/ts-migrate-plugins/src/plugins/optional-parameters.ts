import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import { isOverloaded, provenChanges } from './utils/signature-relaxation';
import { applyTextChanges, TextChange } from '../utils/candidateValidation';
import { isMigratableFile } from '../utils/sourceFiles';
import {
  addToFile,
  createWholeProgramPass,
  Pass,
  planWholeProgram,
} from '../utils/wholeProgramPass';

// Expected {0} arguments, but got {1}.
const ARGUMENT_ARITY = 2554;

const pass = createWholeProgramPass<TextChange>();

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
    const planned = pass.plannedFor(fileName, text, () => plan(languageService));
    if (!planned) return undefined;

    const kept = provenChanges(fileName, text, sourceFile, planned.items, languageService);
    if (!kept) return undefined;
    return applyTextChanges(text, kept);
  },
};

export default optionalParametersPlugin;

function plan(languageService: ts.LanguageService): Pass<TextChange> {
  return planWholeProgram<TextChange>(languageService, ({ program, checker, known }) => {
    const fewestArguments = new Map<ts.SignatureDeclaration, number>();
    program.getSourceFiles().forEach((file) => {
      if (!isMigratableFile(file)) return;
      known.add(file.fileName);
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
      addToFile(changesByFile, fileName, changes);
    });
    return changesByFile;
  });
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
