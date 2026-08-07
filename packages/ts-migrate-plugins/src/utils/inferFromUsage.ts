/**
 * TypeScript's own `inferFromUsage` code fix, as the annotating plugins ask for
 * it: every annotation the language service can infer for one file, with the
 * ones that amount to `any` dropped.
 *
 * Two plugins run it. infer-types annotates the implicit anys a freshly renamed
 * file arrives with; retry-annotations strips the anys an earlier run wrote and
 * asks the same engine what it can infer now that the project's types have
 * moved on. Both need the fix asked for the same way, since a difference
 * between them would show up as one pass undoing the other's work.
 *
 * An annotation may name a type the file does not import, and the fix writes
 * the import that makes it legal alongside it. Both halves come back as edits
 * to the same file, so they are separated here: a caller that keeps some
 * annotations and drops others cannot keep the engine's import edits verbatim,
 * and one that replays the annotations onto different text cannot use their
 * positions at all. `imports` is what those edits add, in a form that survives
 * both.
 */
import ts from 'typescript';
import { applyTextChanges, TextChange } from './candidateValidation';

// Diagnostics the `inferFromUsage` code fix acts on: implicit-any errors
// under noImplicitAny, plus their suggestion-level counterparts without it.
export const inferableDiagnosticCodes = new Set([
  2683, 7005, 7006, 7008, 7010, 7019, 7032, 7033, 7034, 7043, 7044, 7045, 7046, 7047, 7048, 7049,
  7050,
]);

// Annotations where inference fell back to plain `any` are left for the
// explicit-any plugin, which also supports anyAlias.
const anyFallbackRegex = /^\s*(this\s*)?:\s*any(\[\])?\s*$/;

/** The lint settings the annotations are formatted with, where a run knows them. */
export interface LintConfig {
  useTabs: boolean;
  tabWidth: number;
}

export function inferenceFormatSettings(lintConfig?: LintConfig): ts.FormatCodeSettings {
  return {
    ...ts.getDefaultFormatCodeSettings('\n'),
    ...(lintConfig != null
      ? {
          convertTabsToSpaces: !lintConfig.useTabs,
          indentSize: lintConfig.tabWidth,
          tabSize: lintConfig.tabWidth,
        }
      : undefined),
  };
}

/** An import an inferred annotation needs to name the type it names. */
export interface InferredImport {
  /** The local name the annotation spells. */
  name: string;
  moduleSpecifier: string;
  /** A default import rather than a named one. */
  isDefault: boolean;
  /** The engine wrote it as type-only, which `verbatimModuleSyntax` requires. */
  isTypeOnly: boolean;
}

export interface InferenceChanges {
  /** The annotations to write, in the coordinates of the file asked about. */
  annotations: TextChange[];
  /** The engine's own edits to the file's imports, in the same coordinates. */
  importEdits: TextChange[];
  /** What those edits add, in a form that outlives their positions. */
  imports: InferredImport[];
}

export function inferredImportKey(inferredImport: InferredImport): string {
  const kind = inferredImport.isDefault ? 'default' : 'named';
  return `${kind}:${inferredImport.name}:${inferredImport.moduleSpecifier}`;
}

export function getInferenceChanges(
  languageService: ts.LanguageService,
  fileName: string,
  formatSettings: ts.FormatCodeSettings,
  onPartial: (error: unknown) => void,
): InferenceChanges {
  let fileTextChanges: readonly ts.FileTextChanges[];
  try {
    fileTextChanges = languageService.getCombinedCodeFix(
      { type: 'file', fileName },
      'inferFromUsage',
      formatSettings,
      {},
    ).changes;
  } catch (e) {
    // One type the compiler cannot print takes every other type in the file
    // down with it, since the combined fix prints them as one edit. Asking for
    // them one position at a time keeps the ones it can print.
    fileTextChanges = inferenceChangesPerPosition(languageService, fileName, formatSettings);
    // Nothing came back either way: the file is no better off for the retry,
    // so this reaches the plugin's own handler, which reports it and keeps the
    // annotations the file had. Swallowing it would instead read as "this file
    // had nothing to infer" and say nothing.
    if (fileTextChanges.length === 0) throw e;
    onPartial(e);
  }

  // Without strictNullChecks an empty array literal prints as `undefined[]`
  // (with it, `never[]`), so only there does that spelling mean "no element
  // evidence" rather than an array genuinely seeded with undefined values.
  const program = languageService.getProgram();
  const options = program?.getCompilerOptions() ?? {};
  const rewriteUndefinedArrays = !(options.strictNullChecks ?? options.strict);
  const sourceFile = program?.getSourceFile(fileName);

  const annotations: TextChange[] = [];
  const importEdits: TextChange[] = [];
  const seen = new Set<string>();
  fileTextChanges
    .filter((fileChanges) => fileChanges.fileName === fileName)
    .forEach((fileChanges) => {
      fileChanges.textChanges.forEach(({ span, newText }) => {
        if (sourceFile && isImportEdit(sourceFile, span, newText)) {
          // Each annotation that needs an import asks for it separately, so
          // one import two of them share arrives twice.
          const importKey = `import:${span.start}:${span.length}:${newText}`;
          if (seen.has(importKey)) return;
          seen.add(importKey);

          importEdits.push({ start: span.start, length: span.length, text: newText });
          return;
        }

        const annotation = replaceNoEvidenceTypes(newText, rewriteUndefinedArrays);
        // Setter parameters produce the same insert twice (TS7032 + TS7006).
        const key = `${span.start}:${span.length}:${annotation}`;
        if (seen.has(key)) return;
        seen.add(key);

        if (anyFallbackRegex.test(annotation)) return;

        annotations.push({ start: span.start, length: span.length, text: annotation });
      });
    });
  return { annotations, ...importsBoundOnce(sourceFile, importEdits) };
}

/**
 * The import edits, minus any that would bind a name the file already binds,
 * with what the survivors add.
 *
 * The fix writes an import for each type symbol an annotation names, and two
 * symbols can carry one name: `AnyAction` as `redux` declares it and as the
 * toolkit re-exporting it does. Writing both binds the name twice, which is a
 * duplicate identifier rather than two imports, so the first binding stands
 * and the later edit is dropped whole. Where that leaves an annotation reading
 * its name from the wrong module, the annotation stops checking and the
 * caller's validation drops it, which is the answer it has for any other
 * annotation the file rejects.
 */
function importsBoundOnce(
  sourceFile: ts.SourceFile | undefined,
  importEdits: TextChange[],
): { importEdits: TextChange[]; imports: InferredImport[] } {
  const imports = addedImports(sourceFile, importEdits);
  if (!sourceFile || imports.length === 0 || !bindsTwice(sourceFile, imports)) {
    return { importEdits, imports };
  }

  // Read an edit at a time, which the batch cannot be: an edit is kept or
  // dropped by the name it adds, and only its own text says which that is.
  const bound = boundNames(sourceFile);
  const keptEdits: TextChange[] = [];
  const kept: InferredImport[] = [];
  importEdits.forEach((edit) => {
    const added = addedImports(sourceFile, [edit]);
    if (added.some((inferredImport) => bound.has(inferredImport.name))) return;
    added.forEach((inferredImport) => {
      bound.add(inferredImport.name);
      kept.push(inferredImport);
    });
    keptEdits.push(edit);
  });
  return { importEdits: keptEdits, imports: kept };
}

function bindsTwice(sourceFile: ts.SourceFile, imports: InferredImport[]): boolean {
  const bound = boundNames(sourceFile);
  return imports.some((inferredImport) => {
    if (bound.has(inferredImport.name)) return true;
    bound.add(inferredImport.name);
    return false;
  });
}

/**
 * Every name the file's imports bind. Wider than `importedNames`, which
 * reports what can be written back: a namespace import is not something to
 * write, but it is a name that is taken.
 */
function boundNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  sourceFile.statements.forEach((statement) => {
    if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
      return;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) return;
    const { name, namedBindings } = statement.importClause;
    if (name) names.add(name.text);
    if (!namedBindings) return;
    if (ts.isNamespaceImport(namedBindings)) {
      names.add(namedBindings.name.text);
    } else {
      namedBindings.elements.forEach((element) => names.add(element.name.text));
    }
  });
  return names;
}

/**
 * Whether the edit is the fix writing an import rather than an annotation.
 *
 * The two are told apart by where they land, since an import the file has no
 * declaration for yet arrives as a whole statement and one it does arrives as a
 * name spliced into the existing braces, which is the same shape of edit as an
 * annotation. Nothing an annotation can attach to sits inside an import
 * declaration, so the position is enough.
 */
function isImportEdit(sourceFile: ts.SourceFile, span: ts.TextSpan, newText: string): boolean {
  if (span.length === 0 && /^\s*import\b/.test(newText)) return true;
  return sourceFile.statements.some(
    (statement) =>
      (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) &&
      span.start >= statement.getStart(sourceFile) &&
      span.start + span.length <= statement.end,
  );
}

/**
 * The imports `importEdits` add, read off the file they produce rather than
 * off the edits themselves, so however the fix chose to phrase one comes out
 * the same.
 *
 * A namespace import is not reported: nothing here can write one back, and the
 * fix reaches for one only where a module has no export to name.
 */
function addedImports(
  sourceFile: ts.SourceFile | undefined,
  importEdits: TextChange[],
): InferredImport[] {
  if (!sourceFile || importEdits.length === 0) return [];
  let imported: ts.SourceFile;
  try {
    imported = ts.createSourceFile(
      sourceFile.fileName,
      applyTextChanges(sourceFile.text, importEdits),
      sourceFile.languageVersion,
    );
  } catch {
    // Overlapping edits, which is the fix contradicting itself. The caller
    // keeps the edits it has; they are still applied as written.
    return [];
  }
  const before = importedNames(sourceFile);
  return [...importedNames(imported).values()].filter(
    (inferredImport) => !before.has(inferredImportKey(inferredImport)),
  );
}

function importedNames(sourceFile: ts.SourceFile): Map<string, InferredImport> {
  const imports = new Map<string, InferredImport>();
  sourceFile.statements.filter(ts.isImportDeclaration).forEach((statement) => {
    const { importClause } = statement;
    if (!importClause || !ts.isStringLiteral(statement.moduleSpecifier)) return;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const add = (name: string, isDefault: boolean, isTypeOnly: boolean) => {
      const inferredImport = { name, moduleSpecifier, isDefault, isTypeOnly };
      imports.set(inferredImportKey(inferredImport), inferredImport);
    };

    if (importClause.name) add(importClause.name.text, true, importClause.isTypeOnly);
    const { namedBindings } = importClause;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      namedBindings.elements.forEach((element) =>
        add(element.name.text, false, importClause.isTypeOnly || element.isTypeOnly),
      );
    }
  });
  return imports;
}

/**
 * The same fix, asked for one diagnostic at a time. Slower than the combined
 * pass and only worth it once that has failed: a position the compiler cannot
 * print a type for is skipped here rather than taking the file with it.
 *
 * Without noImplicitAny the fix is offered on suggestions rather than errors,
 * which is the scan the combined pass does internally.
 */
function inferenceChangesPerPosition(
  languageService: ts.LanguageService,
  fileName: string,
  formatSettings: ts.FormatCodeSettings,
): ts.FileTextChanges[] {
  const diagnostics = [
    ...languageService.getSuggestionDiagnostics(fileName),
    ...languageService.getSemanticDiagnostics(fileName),
  ].filter(
    (diagnostic) => diagnostic.start !== undefined && inferableDiagnosticCodes.has(diagnostic.code),
  );

  const changes: ts.FileTextChanges[] = [];
  diagnostics.forEach((diagnostic) => {
    const start = diagnostic.start as number;
    try {
      languageService
        .getCodeFixesAtPosition(
          fileName,
          start,
          start + (diagnostic.length ?? 0),
          [diagnostic.code],
          formatSettings,
          {},
        )
        .filter((action) => action.fixName === 'inferFromUsage')
        .forEach((action) => changes.push(...action.changes));
    } catch {
      // The position the combined pass choked on. The rest still stand, and
      // the caller reports that the file got fewer types than it asked for.
    }
  });
  return changes;
}

// A member the inference engine has no evidence for prints as the empty
// object type (banned by @typescript-eslint/no-empty-object-type), and an
// empty array literal as `never[]` — or `undefined[]` without
// strictNullChecks — which rejects every element added later; all spell
// "nothing known", so they become `any`/`any[]`. Tokens are paired with a
// scanner because `{}` can also appear inside a string literal (a property
// named '{}').
function replaceNoEvidenceTypes(annotation: string, rewriteUndefinedArrays: boolean): string {
  if (
    !annotation.includes('{') &&
    !annotation.includes('never') &&
    !(rewriteUndefinedArrays && annotation.includes('undefined'))
  ) {
    return annotation;
  }
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.Standard,
    annotation,
  );
  const spans: Array<{ start: number; end: number; text: string }> = [];
  let openBraceStart = -1;
  let elementKeywordStart = -1;
  let arrayStart = -1;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.CloseBraceToken && openBraceStart >= 0) {
      spans.push({ start: openBraceStart, end: scanner.getTokenEnd(), text: 'any' });
    } else if (token === ts.SyntaxKind.CloseBracketToken && arrayStart >= 0) {
      spans.push({ start: arrayStart, end: scanner.getTokenEnd(), text: 'any[]' });
    }
    openBraceStart = token === ts.SyntaxKind.OpenBraceToken ? scanner.getTokenStart() : -1;
    arrayStart = token === ts.SyntaxKind.OpenBracketToken ? elementKeywordStart : -1;
    elementKeywordStart =
      token === ts.SyntaxKind.NeverKeyword ||
      (rewriteUndefinedArrays && token === ts.SyntaxKind.UndefinedKeyword)
        ? scanner.getTokenStart()
        : -1;
  }
  let result = annotation;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    result = `${result.slice(0, spans[i].start)}${spans[i].text}${result.slice(spans[i].end)}`;
  }
  return result;
}
