import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import createFollowUpMarkers from '../utils/followUpMarker';
import { inferenceFormatSettings } from '../utils/inferFromUsage';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import {
  applyImportChanges,
  combinedImportChanges,
  findMissingImports,
  isAmbiguous,
  MissingImport,
  MissingImportContext,
} from '../utils/missingImports';
import { createValidate, Properties } from '../utils/validateOptions';
import { importClauseNames } from './utils/imports';

/**
 * Imports the names a file uses but never brings in, from the module
 * TypeScript's own quick fix would offer.
 *
 * A renamed file is full of names that resolved through something the compiler
 * does not read: a bundler that injected them as globals, a `require` a
 * transform hoisted away, an import an earlier pass dropped. Each one is
 * reported as TS2304 and, left alone, ends up under a suppression comment, and
 * a suppressed name is `any` for the rest of the run, so every type read
 * through it is lost as well.
 *
 * The pick is TypeScript's, not this plugin's. Where TypeScript offers a name
 * from more than one module the choice is a guess, so it is made only under
 * `ambiguous: 'first'` (the default, and what "Add all missing imports" does in
 * an editor), the site is marked, and the run reports it; under
 * `ambiguous: 'skip'` the name is left for ts-ignore to suppress and a person
 * to import.
 */
type Options = {
  /** What to do with a name TypeScript offers from more than one module. */
  ambiguous?: 'first' | 'skip';
  /** How an added specifier is written. TypeScript's own preference by default. */
  moduleSpecifier?: 'shortest' | 'project-relative' | 'relative' | 'non-relative';
};

const optionProperties: Properties = {
  ambiguous: { enum: ['first', 'skip'] },
  moduleSpecifier: { enum: ['shortest', 'project-relative', 'relative', 'non-relative'] },
};

const addMissingImportsPlugin: Plugin<Options> = {
  name: 'add-missing-imports',

  run(params, lintConfig) {
    const { getLanguageService, fileName, sourceFile, text, options, moduleResolution } = params;
    const reportNotice = fileNoticeReporter(params, '[add-missing-imports]');

    const context: MissingImportContext = {
      languageService: getLanguageService(),
      fileName,
      sourceFile,
      formatSettings: inferenceFormatSettings(lintConfig, ts.sys.newLine),
      preferences: {
        quotePreference: 'auto',
        importModuleSpecifierEnding: 'auto',
        importModuleSpecifierPreference: options.moduleSpecifier,
      },
      moduleResolution,
    };

    const missing = findMissingImports(context);
    if (missing.length === 0) return text;

    const ambiguous = missing.filter(isAmbiguous);
    const skipAmbiguous = options.ambiguous === 'skip';
    if (skipAmbiguous && ambiguous.length > 0) {
      reportNotice({
        reason: 'left a name TypeScript offered from more than one module unimported',
        hint:
          'Those names keep the suppression comment ts-ignore writes for them. Run with ' +
          '--ambiguousImports=first to take the module TypeScript ranks first instead.',
        recovered: true,
      });
    }

    const allowed = new Set(
      missing
        .filter((name) => !(skipAmbiguous && isAmbiguous(name)))
        .map((missingImport) => missingImport.name),
    );
    if (allowed.size === 0) return text;

    const changes = combinedImportChanges(context);
    if (changes.length === 0) return text;

    const imported = applyImportChanges(sourceFile, changes, allowed);
    if (imported === text) return text;
    if (skipAmbiguous) return imported;

    const { marked, text: markedText } = markAmbiguousImports(imported, fileName, ambiguous);
    if (ambiguous.length > 0) {
      reportNotice({
        reason: 'imported a name TypeScript offered from more than one module',
        hint:
          'The module TypeScript ranks first was taken, which is a guess where the name is ' +
          'exported by several. Check each marked import against the alternatives it names.',
        recovered: true,
        marked,
      });
    }
    return markedText;
  },

  validate: createValidate(optionProperties),
};

export default addMissingImportsPlugin;

/**
 * A marker above each import that carries a name several modules export, naming
 * the ones that were passed over. The choice type-checks either way, so nothing
 * downstream will report it: the file is where a person finds it.
 */
function markAmbiguousImports(
  text: string,
  fileName: string,
  ambiguous: MissingImport[],
): { text: string; marked: boolean } {
  if (ambiguous.length === 0) return { text, marked: false };

  const byName = new Map(ambiguous.map((missing) => [missing.name, missing]));
  const parsed = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const markers = createFollowUpMarkers(parsed);
  const updates: SourceTextUpdate[] = [];
  let marked = false;

  parsed.statements.filter(ts.isImportDeclaration).forEach((declaration) => {
    const carried = importClauseNames(declaration.importClause)
      .map((name) => byName.get(name))
      .filter((missing): missing is MissingImport => missing !== undefined);
    if (carried.length === 0) return;

    // The module named is the one the statement really imports from, rather
    // than the candidate scan's first, so the note stays true of the line it
    // sits above whichever way the two passes ranked the modules.
    const { moduleSpecifier } = declaration;
    const taken = ts.isStringLiteralLike(moduleSpecifier)
      ? moduleSpecifier.text
      : moduleSpecifier.getText(parsed);
    const result = markers.add(declaration, {
      hint: 'Check that this import is the one meant; TypeScript offered the name from several modules.',
      reason: carried.map((missing) => describeChoice(missing, taken)).join(' '),
    });
    if (result.update) updates.push(result.update);
    marked = marked || result.marked;
  });

  return { text: updateSourceText(text, updates), marked };
}

function describeChoice({ name, candidates }: MissingImport, taken: string): string {
  const passed = candidates
    .map((candidate) => candidate.specifier)
    .filter((specifier) => specifier !== taken);
  return passed.length > 0
    ? `${name} was taken from ${taken}, over ${passed.join(' and ')}.`
    : `${name} was taken from ${taken}, over a module exporting the same name.`;
}
