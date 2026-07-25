type Insert = { kind: 'insert'; index: number; text: string };
type Replace = { kind: 'replace'; index: number; length: number; text: string };
type Delete = { kind: 'delete'; index: number; length: number };

export type SourceTextUpdate = Insert | Replace | Delete;

/** How much of the source an update consumes. An insert consumes nothing. */
function spannedLength(update: SourceTextUpdate): number {
  return update.kind === 'insert' ? 0 : update.length;
}

/**
 * An insert at the position a replace starts writes its text before the
 * replacement, not after it. Ordering the two here rather than leaving it to
 * the order a plugin happened to push them in is what makes the result the
 * same either way: the other order used to walk the output position backwards
 * and duplicate the text between them.
 */
function kindOrder(update: SourceTextUpdate): number {
  return update.kind === 'insert' ? 0 : 1;
}

export default function updateSourceText(sourceText: string, updates: SourceTextUpdate[]): string {
  if (updates.length === 0) {
    return sourceText;
  }

  // Stable beyond these two keys, so several inserts at one position keep the
  // order the plugin built them in.
  const sortedUpdates = [...updates].sort(
    (update1, update2) => update1.index - update2.index || kindOrder(update1) - kindOrder(update2),
  );

  verifyUpdates(sourceText, sortedUpdates);

  let out = '';
  let index = 0;
  sortedUpdates.forEach((update) => {
    out += sourceText.slice(index, update.index);

    if (update.kind === 'insert') {
      out += update.text;
      index = update.index;
    } else if (update.kind === 'replace') {
      out += update.text;
      index = update.index + update.length;
    } else if (update.kind === 'delete') {
      index = update.index + update.length;
    } else {
      unreachable(update);
    }
  });
  out += sourceText.slice(index);

  return out;
}

function verifyUpdates(sourceText: string, updates: SourceTextUpdate[]) {
  updates.forEach((update) => {
    if (update.index < 0) {
      throw new Error('Update has negative index');
    }
    if ((update.kind === 'replace' || update.kind === 'delete') && update.length < 0) {
      throw new Error('Update has negative length');
    }
    // TODO(brie): throw if out of sourceText bounds
  });

  // Sorted, so only neighbours can collide. An update that starts inside the
  // span of the one before it does not fail the walk above: the slice between
  // them comes back empty and the output position moves backwards, so the text
  // in between is written twice and the file a plugin was fixing is corrupted
  // instead. Whichever plugin built them has a bug, and one file failing to
  // migrate is what the runner is built to survive.
  for (let i = 1; i < updates.length; i += 1) {
    const previous = updates[i - 1];
    const update = updates[i];
    if (update.index < previous.index + spannedLength(previous)) {
      throw new Error(
        `Updates overlap: ${describeUpdate(previous, sourceText)} and ` +
          `${describeUpdate(update, sourceText)}.`,
      );
    }
  }
}

/** Enough to find the site in the file the updates were built from. */
function describeUpdate(update: SourceTextUpdate, sourceText: string): string {
  const { line, column } = positionOf(sourceText, update.index);
  const where = `line ${line}, column ${column}`;
  if (update.kind === 'insert') return `insert at ${update.index} (${where})`;
  return `${update.kind} of ${update.index}..${update.index + update.length} (${where})`;
}

/** One-based, to read like an editor rather than like an offset. */
function positionOf(sourceText: string, index: number): { line: number; column: number } {
  const before = sourceText.slice(0, index);
  const lineStart = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: index - lineStart };
}

function unreachable(_arg: never): never {
  throw new Error('');
}
