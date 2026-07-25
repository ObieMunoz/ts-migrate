import ts from 'typescript';
import { SourceTextUpdate } from './updateSourceText';

/** What `grep -rn "TODO(ts-migrate)"` finds. */
export const FOLLOW_UP_MARKER = 'TODO(ts-migrate)';

export interface FollowUpMarkers {
  /**
   * Marks the site this node belongs to. Returns the edit to apply, absent when
   * the site is already marked, and whether the site carries a marker at all:
   * a plugin reports that so the run never promises a `grep` that finds
   * nothing.
   */
  add(node: ts.Node, note: { hint: string; reason: string }): FollowUpMarker;
}

export interface FollowUpMarker {
  /** Always an insert, so a caller holding text ranges can splice it directly. */
  update?: Extract<SourceTextUpdate, { kind: 'insert' }>;
  marked: boolean;
}

/**
 * Comments at the sites a plugin declined to change. A migration of any size
 * prints thousands of lines, so a warning about work only a person can do is
 * read once and then scrolled past; the file the edit has to happen in is the
 * one place the note survives to be found.
 *
 * Per file, because one site gets one marker however many causes land on it:
 * a plugin that reports per expression can have several resolve to the same
 * statement.
 */
export default function createFollowUpMarkers(sourceFile: ts.SourceFile): FollowUpMarkers {
  const marked = new Set<ts.Node>();
  return {
    add(node, { hint, reason }) {
      const site = markerSite(node, sourceFile);
      if (!site) return { marked: false };
      if (marked.has(site)) return { marked: true };
      marked.add(site);
      // One left by an earlier run still marks the site; writing a second
      // would stack them on every run.
      if (hasFollowUpMarker(site, sourceFile)) return { marked: true };

      const index = siteStart(site, sourceFile);
      const indent = sourceFile.text.slice(sourceFile.text.lastIndexOf('\n', index - 1) + 1, index);
      const lines = wrap(`${FOLLOW_UP_MARKER}: ${hint}`, indent.length).concat(
        wrap(reason, indent.length),
      );
      return {
        update: {
          kind: 'insert',
          index,
          text: `${lines.map((line) => `// ${line}`).join(`\n${indent}`)}\n${indent}`,
        },
        marked: true,
      };
    },
  };
}

/**
 * The nearest node at or above this one that begins its own line. A marker is a
 * line comment, so anywhere else it would comment out the code beside it, and
 * the site a plugin names is often an expression in the middle of a statement.
 */
export function markerSite(node: ts.Node, sourceFile: ts.SourceFile): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (startsLine(current, sourceFile)) return widestAtSameStart(current, sourceFile);
    current = current.parent;
  }
  return undefined;
}

/**
 * The whole construct that begins where this node does. A statement and the
 * declaration list inside it share a start, but only the statement carries the
 * doc comment, so stopping at the inner one puts the marker between a comment
 * and what it documents. Widening stops where it would move the marker onto a
 * line that begins with something else, which is what a doc comment attached to
 * an inner expression does.
 */
function widestAtSameStart(node: ts.Node, sourceFile: ts.SourceFile): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    current.parent.getStart(sourceFile) === current.getStart(sourceFile) &&
    startsLine(current.parent, sourceFile)
  ) {
    current = current.parent;
  }
  return current;
}

/** Whether only whitespace precedes the marker position on its line. */
function startsLine(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const start = siteStart(node, sourceFile);
  return !/\S/.test(
    sourceFile.text.slice(sourceFile.text.lastIndexOf('\n', start - 1) + 1, start),
  );
}

/**
 * Where a marker for this node goes. A doc comment is part of what the marker
 * is about, so the marker belongs above it rather than between it and the code
 * it documents.
 */
function siteStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  return node.getStart(sourceFile, /* includeJsDocComment */ true);
}

/**
 * Whether this site is already marked, so re-running does not stack them.
 *
 * Read from the position rather than the node's leading trivia: a marker above
 * a doc comment is not in that comment's own trivia, and a later plugin can put
 * a suppression comment between the marker and the code.
 */
export function hasFollowUpMarker(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const lines = sourceFile.text.slice(0, siteStart(node, sourceFile)).split('\n');
  // The last entry is the site's own line, up to where the marker would go.
  lines.pop();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('//')) return false;
    if (line.includes(FOLLOW_UP_MARKER)) return true;
  }
  return false;
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
