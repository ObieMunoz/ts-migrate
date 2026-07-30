import ts from 'typescript';
import { SourceTextUpdate } from './updateSourceText';

// A value that came in through `import type` is not imported at all once
// TypeScript emits: the declaration is erased, so the name is undefined where
// it is used. Suppressing one of these turns a compile error into a crash.
export const TYPE_ONLY_IMPORT_OF_VALUE = 1361;

export interface TypeOnlyImportRepairs {
  /** The `type` modifiers to drop, deduplicated across the uses that ask. */
  updates: SourceTextUpdate[];
  /** The diagnostics those updates answer, which need no suppression. */
  repaired: Set<ts.Diagnostic>;
  /** Uses left for the caller to suppress, because no repair was offered. */
  unrepaired: ts.Diagnostic[];
}

/**
 * The `type` modifiers to drop from a file's imports whose value is used.
 *
 * No ts-migrate plugin writes `import type`, but eslint-fix runs the project's
 * own config, and a rule that rewrites value imports as type-only ones can flip
 * an import whose value use is not visible to it at the moment it runs. What
 * reaches the passes below is a file that imports a function as a type and then
 * calls it, and that is theirs to repair rather than to hide.
 *
 * TypeScript offers the removal itself, and only for a name that has a value to
 * import: one that is only ever a type is reported as TS2693 with no fix, and
 * still ends up suppressed. Every use site reports the same diagnostic and asks
 * for the same edit, so the spans are deduplicated.
 */
export default function typeOnlyImportRepairs(
  languageService: ts.LanguageService,
  fileName: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly ts.Diagnostic[],
): TypeOnlyImportRepairs {
  const updates = new Map<string, SourceTextUpdate>();
  const repaired = new Set<ts.Diagnostic>();
  const unrepaired: ts.Diagnostic[] = [];

  diagnostics
    .filter((diagnostic) => diagnostic.code === TYPE_ONLY_IMPORT_OF_VALUE)
    .forEach((diagnostic) => {
      const spans = modifierRemovalSpans(languageService, fileName, sourceFile, diagnostic);
      if (spans.length === 0) {
        unrepaired.push(diagnostic);
        return;
      }
      spans.forEach((span) =>
        updates.set(`${span.start}:${span.length}`, {
          kind: 'delete',
          index: span.start,
          length: span.length,
        }),
      );
      repaired.add(diagnostic);
    });

  return { updates: [...updates.values()], repaired, unrepaired };
}

/**
 * The spans of the fix TypeScript offers for one such use, when all it does is
 * take out a `type` modifier. A fix of any other shape is not this repair, and
 * rewriting more of the file than a modifier on the strength of a diagnostic
 * code is not worth the reach; the use gets suppressed instead.
 */
function modifierRemovalSpans(
  languageService: ts.LanguageService,
  fileName: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): ts.TextSpan[] {
  if (diagnostic.start === undefined || diagnostic.length === undefined) return [];

  let fixes: readonly ts.CodeFixAction[];
  try {
    fixes = languageService.getCodeFixesAtPosition(
      fileName,
      diagnostic.start,
      diagnostic.start + diagnostic.length,
      [diagnostic.code],
      {},
      {},
    );
  } catch {
    // The service declined this position; the use is suppressed instead.
    return [];
  }

  const changes = fixes.filter((fix) => fix.fixName === 'import').flatMap((fix) => fix.changes);
  const textChanges = changes.flatMap((change) => change.textChanges);
  const isThisRepair =
    changes.every((change) => change.fileName === fileName) &&
    textChanges.every((change) => isModifierRemoval(change, sourceFile));

  return isThisRepair ? textChanges.map((change) => change.span) : [];
}

/**
 * Whether a text change only takes out a `type` modifier, and nothing else.
 * Which side's whitespace goes with the keyword is the compiler's to pick: a
 * modifier on the declaration takes the space before it, an inline one the
 * space after.
 */
function isModifierRemoval(change: ts.TextChange, sourceFile: ts.SourceFile): boolean {
  const removed = sourceFile.text.slice(change.span.start, change.span.start + change.span.length);
  return change.newText === '' && /^\s*type\s*$/.test(removed);
}
