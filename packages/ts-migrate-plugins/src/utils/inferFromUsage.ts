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
 */
import ts from 'typescript';
import { TextChange } from './candidateValidation';

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

export function getInferenceChanges(
  languageService: ts.LanguageService,
  fileName: string,
  formatSettings: ts.FormatCodeSettings,
  onPartial: (error: unknown) => void,
): TextChange[] {
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
  const options = languageService.getProgram()?.getCompilerOptions() ?? {};
  const rewriteUndefinedArrays = !(options.strictNullChecks ?? options.strict);

  const changes: TextChange[] = [];
  const seen = new Set<string>();
  fileTextChanges
    .filter((fileChanges) => fileChanges.fileName === fileName)
    .forEach((fileChanges) => {
      fileChanges.textChanges.forEach(({ span, newText }) => {
        const annotation = replaceNoEvidenceTypes(newText, rewriteUndefinedArrays);
        // Setter parameters produce the same insert twice (TS7032 + TS7006).
        const key = `${span.start}:${span.length}:${annotation}`;
        if (seen.has(key)) return;
        seen.add(key);

        if (anyFallbackRegex.test(annotation)) return;

        changes.push({ start: span.start, length: span.length, text: annotation });
      });
    });
  return changes;
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
