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

/**
 * Annotates implicit-any locations with types the TypeScript language
 * service can infer from usage, so that only the truly undeterminable ones
 * fall through to the explicit-any plugin.
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

    let actions: ts.CombinedCodeActions;
    try {
      actions = languageService.getCombinedCodeFix(
        { type: 'file', fileName },
        'inferFromUsage',
        formatSettings,
        {},
      );
    } catch (e) {
      if (e instanceof Error) {
        console.error('Error occurred in infer-types plugin: ', e.message);
      }
      return undefined;
    }

    const updates: SourceTextUpdate[] = [];
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

          updates.push(
            span.length === 0
              ? { kind: 'insert', index: span.start, text: newText }
              : { kind: 'replace', index: span.start, length: span.length, text: newText },
          );
        });
      });

    // Parenthesizing an arrow parameter whose annotation was skipped is not
    // worth a diff on its own.
    if (updates.every((update) => update.kind === 'insert' && /^[()]$/.test(update.text))) {
      return undefined;
    }

    return updateSourceText(text, updates);
  },
};

export default inferTypesPlugin;
