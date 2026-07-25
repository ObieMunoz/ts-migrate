import ts from 'typescript';
import { SourceTextUpdate } from './updateSourceText';

/** What `grep -rn "TODO(ts-migrate)"` finds. */
export const FOLLOW_UP_MARKER = 'TODO(ts-migrate)';

/**
 * A comment at the site a plugin declined to change. A migration of any size
 * prints thousands of lines, so a warning about work only a person can do is
 * read once and then scrolled past; the file the edit has to happen in is the
 * one place the note survives to be found.
 */
export default function followUpMarkerUpdate(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  /** Both are whole sentences: the hint is what to do, the reason is why it is still here. */
  { hint, reason }: { hint: string; reason: string },
): SourceTextUpdate | undefined {
  if (hasFollowUpMarker(node, sourceFile)) return undefined;

  const index = node.getStart(sourceFile);
  const indent = sourceFile.text.slice(sourceFile.text.lastIndexOf('\n', index - 1) + 1, index);
  // Anything but whitespace before the node means it shares a line with code a
  // comment above it would then be read as describing.
  if (/\S/.test(indent)) return undefined;

  const lines = wrap(`${FOLLOW_UP_MARKER}: ${hint}`, indent.length).concat(
    wrap(reason, indent.length),
  );
  return {
    kind: 'insert',
    index,
    text: `${lines.map((line) => `// ${line}`).join(`\n${indent}`)}\n${indent}`,
  };
}

/** Wide enough not to fragment a sentence, narrow enough to read beside the code. */
const MARKER_WIDTH = 96;

function wrap(sentence: string, indentWidth: number): string[] {
  const width = Math.max(MARKER_WIDTH - indentWidth - '// '.length, 20);
  const lines: string[] = [];
  sentence.split(' ').forEach((word) => {
    const line = lines[lines.length - 1];
    if (line !== undefined && `${line} ${word}`.length <= width) {
      lines[lines.length - 1] = `${line} ${word}`;
    } else {
      lines.push(word);
    }
  });
  return lines;
}

/** Whether this site is already marked, so re-running does not stack them. */
export function hasFollowUpMarker(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return ranges.some((range) =>
    sourceFile.text.slice(range.pos, range.end).includes(FOLLOW_UP_MARKER),
  );
}
