/**
 * The import edits an annotated file needs, rebuilt from what the inference
 * engine said its annotations import.
 *
 * The engine writes those imports itself, but only for the annotations it
 * proposed all at once. Both plugins that run it then decide annotation by
 * annotation what to keep, and one of them replays the annotations onto text
 * the engine never saw, so its edits cannot be carried along verbatim: an
 * import whose only annotation was dropped would be left behind unused, and one
 * an annotation still needs would be left out. Asking for them again against
 * the text that is actually being written keeps the two in step, since
 * `updateImports` adds a name only where the file uses it and does not already
 * import it.
 */
import ts from 'typescript';
import { InferredImport } from '../../utils/inferFromUsage';
import { applyTextChanges, TextChange, toOriginalPos } from '../../utils/candidateValidation';
import { updateImports } from './imports';

/**
 * The edits that bring `text`'s imports up to date with `annotations`, in the
 * coordinates of `text` itself, so a caller can apply and validate them as one
 * set with the annotations.
 */
export function importChangesFor(
  fileName: string,
  text: string,
  annotations: TextChange[],
  imports: InferredImport[],
): TextChange[] {
  if (imports.length === 0) return [];

  const inOrder = [...annotations].sort((a, b) => a.start - b.start);
  // Parents and all: a declaration reprinted to hold one more name keeps the
  // module specifier it was written with only where the printer can reach the
  // original text, and the quotes in it are not this pass's to change.
  const annotated = ts.createSourceFile(
    fileName,
    applyTextChanges(text, inOrder),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const updates = updateImports(
    annotated,
    imports.map((inferredImport) =>
      inferredImport.isDefault
        ? {
            defaultImport: inferredImport.name,
            moduleSpecifier: inferredImport.moduleSpecifier,
          }
        : {
            namedImport: inferredImport.name,
            moduleSpecifier: inferredImport.moduleSpecifier,
            isTypeOnly: inferredImport.isTypeOnly,
          },
    ),
    [],
  );

  // Imports sit outside every annotation, so a span measured in the annotated
  // text is the same span in the original once its start is mapped back.
  return updates.map((update) => ({
    start: toOriginalPos(update.index, inOrder),
    length: update.kind === 'insert' ? 0 : update.length,
    text: update.kind === 'delete' ? '' : update.text,
  }));
}

/** The annotations and the imports they need, as one set of edits to `text`. */
export function withImportChanges(
  fileName: string,
  text: string,
  annotations: TextChange[],
  imports: InferredImport[],
): TextChange[] {
  return [...annotations, ...importChangesFor(fileName, text, annotations, imports)].sort(
    (a, b) => a.start - b.start,
  );
}
