import path from 'path';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';

export interface LintConfig {
  useTabs: boolean;
  tabWidth: number;
}

// Diagnostics the `inferFromUsage` code fix acts on: implicit-any errors
// under noImplicitAny, plus their suggestion-level counterparts without it.
const inferableDiagnosticCodes = new Set([
  2683, 7005, 7006, 7008, 7010, 7019, 7032, 7033, 7034, 7043, 7044, 7045, 7046, 7047, 7048, 7049,
  7050,
]);

// Annotations where inference fell back to plain `any` are left for the
// explicit-any plugin, which also supports anyAlias.
const anyFallbackRegex = /^\s*(this\s*)?:\s*any(\[\])?\s*$/;

// Errors reported on the arguments of a call that no longer matches the
// callee's signature.
const callArgumentErrorCodes = new Set([2345, 2554, 2555, 2559, 2769]);

const bodyOnlySuffix = 'TsMigrateBodyOnly';

interface TextChange {
  start: number;
  length: number;
  text: string;
}

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

  run({ fileName, text, getLanguageService }, lintConfig?: LintConfig) {
    const languageService = getLanguageService();
    const hasInferableDiagnostics = [
      ...languageService.getSemanticDiagnostics(fileName),
      ...languageService.getSuggestionDiagnostics(fileName),
    ].some((diagnostic) => inferableDiagnosticCodes.has(diagnostic.code));
    if (!hasInferableDiagnostics) {
      return undefined;
    }

    const formatSettings: ts.FormatCodeSettings = {
      ...ts.getDefaultFormatCodeSettings('\n'),
      ...(lintConfig != null
        ? {
            convertTabsToSpaces: !lintConfig.useTabs,
            indentSize: lintConfig.tabWidth,
            tabSize: lintConfig.tabWidth,
          }
        : undefined),
    };

    try {
      const changes = getInferenceChanges(languageService, fileName, formatSettings);
      if (changes.length === 0) {
        return undefined;
      }

      const program = languageService.getProgram();
      const compilerOptions: ts.CompilerOptions = {
        ...(program ? program.getCompilerOptions() : {}),
        skipLibCheck: true,
      };

      return withBodyWins(fileName, text, changes, compilerOptions, formatSettings);
    } catch (e) {
      if (e instanceof Error) {
        console.error('Error occurred in infer-types plugin: ', e.message);
      }
      return undefined;
    }
  },
};

export default inferTypesPlugin;

function withBodyWins(
  fileName: string,
  text: string,
  changes: TextChange[],
  compilerOptions: ts.CompilerOptions,
  formatSettings: ts.FormatCodeSettings,
): string | undefined {
  const baseline = createFileLanguageService(fileName, text, compilerOptions);
  const candidateText = applyTextChanges(text, changes);
  const candidate = createFileLanguageService(fileName, candidateText, compilerOptions);

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

  const contested = attributeErrors(newErrors, candidate, fileName, changes, originalSource);

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

  // Body-only annotations may still contradict the body (a TS expressiveness
  // limit); drop those functions entirely rather than suppressing inside them.
  let finalText = applyTextChanges(text, finalChanges);
  const finalService = createFileLanguageService(fileName, finalText, compilerOptions);
  const finalErrors = findNewErrors(baseline, finalService, finalChanges, fileName);
  const bodyConflicted = attributeErrors(
    finalErrors,
    finalService,
    fileName,
    finalChanges,
    originalSource,
    { bodyErrorsOnly: true },
  );
  if (bodyConflicted.size > 0) {
    finalChanges = assemble(bodyConflicted);
    if (isNoOp(finalChanges)) {
      return undefined;
    }
    finalText = applyTextChanges(text, finalChanges);
  }

  return finalText;
}

function getInferenceChanges(
  languageService: ts.LanguageService,
  fileName: string,
  formatSettings: ts.FormatCodeSettings,
): TextChange[] {
  let actions: ts.CombinedCodeActions;
  try {
    actions = languageService.getCombinedCodeFix(
      { type: 'file', fileName },
      'inferFromUsage',
      formatSettings,
      {},
    );
  } catch {
    return [];
  }

  const changes: TextChange[] = [];
  const seen = new Set<string>();
  actions.changes
    .filter((fileChanges) => fileChanges.fileName === fileName)
    .forEach((fileChanges) => {
      fileChanges.textChanges.forEach(({ span, newText }) => {
        // Setter parameters produce the same insert twice (TS7032 + TS7006).
        const key = `${span.start}:${span.length}:${newText}`;
        if (seen.has(key)) return;
        seen.add(key);

        if (anyFallbackRegex.test(newText)) return;

        changes.push({ start: span.start, length: span.length, text: newText });
      });
    });
  return changes;
}

function inferBodyOnly(
  contestedFunctions: ts.Node[],
  baseline: ts.LanguageService,
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  formatSettings: ts.FormatCodeSettings,
  originalSource: ts.SourceFile,
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
  const decoy = createFileLanguageService(fileName, decoyText, compilerOptions);
  getInferenceChanges(decoy, fileName, formatSettings).forEach((change) => {
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
  { bodyErrorsOnly = false }: { bodyErrorsOnly?: boolean } = {},
): Set<ts.Node | null> {
  const attributed = new Set<ts.Node | null>();
  const program = service.getProgram();
  if (!program) return attributed;
  const source = program.getSourceFile(fileName);
  if (!source) return attributed;
  const checker = program.getTypeChecker();

  errors.forEach((error) => {
    if (error.start == null) return;

    if (callArgumentErrorCodes.has(error.code)) {
      const callee = calleeDeclarationAt(source, error.start, checker);
      if (callee && callee.getSourceFile() === source) {
        const originalFn = enclosingFunctionLike(
          originalSource,
          toOriginalPos(callee.getStart(), changes),
        );
        if (originalFn != null) {
          // A mismatched argument marks the *callee* as contested; in the
          // final pass such flags on body-validated signatures are expected.
          if (!bodyErrorsOnly) attributed.add(originalFn);
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
  position: number,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  let node = nodeAt(source, position);
  while (node && !ts.isCallExpression(node) && !ts.isNewExpression(node)) {
    node = node.parent;
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

function findNewErrors(
  baseline: ts.LanguageService,
  candidate: ts.LanguageService,
  changes: TextChange[],
  fileName: string,
): ts.Diagnostic[] {
  const isError = (d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error;
  const baselineKeys = new Set(
    baseline
      .getSemanticDiagnostics(fileName)
      .filter(isError)
      .map((d) => `${d.code}:${d.start == null ? '' : toCandidatePos(d.start, changes)}`),
  );
  return candidate
    .getSemanticDiagnostics(fileName)
    .filter(isError)
    .filter((d) => !baselineKeys.has(`${d.code}:${d.start == null ? '' : d.start}`));
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
  let result: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    if (node.getStart() <= position && position < node.end) {
      if (isFunctionLikeWithBody(node)) {
        result = node;
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

function toCandidatePos(originalPos: number, changes: TextChange[]): number {
  let shift = 0;
  changes.forEach((change) => {
    if (change.start <= originalPos) {
      shift += change.text.length - change.length;
    }
  });
  return originalPos + shift;
}

function toOriginalPos(candidatePos: number, changes: TextChange[]): number {
  let shift = 0;
  for (const change of changes) {
    if (change.start + shift >= candidatePos) break;
    shift += change.text.length - change.length;
  }
  return candidatePos - shift;
}

function applyTextChanges(text: string, changes: TextChange[]): string {
  const updates: SourceTextUpdate[] = changes.map((change) =>
    change.length === 0
      ? { kind: 'insert', index: change.start, text: change.text }
      : { kind: 'replace', index: change.start, length: change.length, text: change.text },
  );
  return updateSourceText(text, updates);
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

function createFileLanguageService(
  fileName: string,
  content: string,
  compilerOptions: ts.CompilerOptions,
): ts.LanguageService {
  // Only the file under migration is overridden; imports and default libs
  // resolve from disk.
  const files = new Map([[fileName, content]]);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: () => '0',
    getScriptSnapshot: (name) => {
      const contents = files.get(name) ?? ts.sys.readFile(name);
      return contents !== undefined ? ts.ScriptSnapshot.fromString(contents) : undefined;
    },
    getCurrentDirectory: () => path.dirname(fileName),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
  };
  return ts.createLanguageService(host);
}
