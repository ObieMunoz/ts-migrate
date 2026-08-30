import json5 from 'json5';

/**
 * Targeted text splices for JSON5 config files (project.json and friends).
 * Edits are applied to the original source text, so comments, quoting, and
 * formatting outside the edited spans are preserved exactly.
 */

export type JSON5Path = ReadonlyArray<string | number>;

interface ObjectNode {
  kind: 'object';
  start: number;
  end: number;
  members: Array<{ key: string; keyStart: number; value: ValueNode }>;
}

interface ArrayNode {
  kind: 'array';
  start: number;
  end: number;
  elements: ValueNode[];
}

interface StringNode {
  kind: 'string';
  start: number;
  end: number;
  value: string;
}

// Numbers, booleans, null, NaN, Infinity.
interface BareNode {
  kind: 'bare';
  start: number;
  end: number;
}

type ValueNode = ObjectNode | ArrayNode | StringNode | BareNode;

interface Splice {
  start: number;
  end: number;
  text: string;
}

/**
 * Replaces string values for which `getReplacement` returns a new value.
 * `path` addresses the value from the document root, e.g. `['allowedImports', 0]`.
 */
export function replaceJSON5Strings(
  sourceText: string,
  getReplacement: (path: JSON5Path, value: string) => string | undefined,
): string {
  const splices: Splice[] = [];

  const visit = (node: ValueNode, path: JSON5Path): void => {
    if (node.kind === 'string') {
      const replacement = getReplacement(path, node.value);
      if (replacement !== undefined && replacement !== node.value) {
        const quote = sourceText[node.start];
        splices.push({
          start: node.start,
          end: node.end,
          text: json5.stringify(replacement, { quote }),
        });
      }
    } else if (node.kind === 'array') {
      node.elements.forEach((element, i) => visit(element, [...path, i]));
    } else if (node.kind === 'object') {
      node.members.forEach((member) => visit(member.value, [...path, member.key]));
    }
  };

  visit(parseDocument(sourceText), []);
  return applySplices(sourceText, splices);
}

/**
 * Sets the value at `keyPath`, creating missing objects along the way.
 * The root value must be an object. Inserted keys are double-quoted.
 */
export function setJSON5Key(
  sourceText: string,
  keyPath: ReadonlyArray<string>,
  value: string | number | boolean | null,
): string {
  let node = parseObjectRoot(sourceText, keyPath);
  for (let i = 0; i < keyPath.length; i += 1) {
    const member = node.members.find((m) => m.key === keyPath[i]);
    if (!member) {
      return insertMember(sourceText, node, keyPath.slice(i), encodeJSON5(value));
    }
    if (i === keyPath.length - 1 || member.value.kind !== 'object') {
      const remainingPath = keyPath.slice(i + 1);
      return applySplices(sourceText, [
        {
          start: member.value.start,
          end: member.value.end,
          text: buildNestedValue(remainingPath, encodeJSON5(value)),
        },
      ]);
    }
    node = member.value;
  }

  throw new Error('updateJSON5: failed to resolve keyPath');
}

/**
 * Appends a string to the array at `keyPath`, creating `keyPath: [value]` when
 * the key is absent and returning the text unchanged when the array already
 * holds the value. Throws when the key holds something other than an array.
 */
export function appendJSON5ArrayItem(
  sourceText: string,
  keyPath: ReadonlyArray<string>,
  value: string,
): string {
  let node = parseObjectRoot(sourceText, keyPath);
  for (let i = 0; i < keyPath.length; i += 1) {
    const member = node.members.find((m) => m.key === keyPath[i]);
    if (!member) {
      return insertMember(sourceText, node, keyPath.slice(i), `[${encodeJSON5(value)}]`);
    }
    if (i === keyPath.length - 1) {
      if (member.value.kind !== 'array') {
        throw new Error(`updateJSON5: ${keyPath.join('.')} is not an array`);
      }
      if (member.value.elements.some((el) => el.kind === 'string' && el.value === value)) {
        return sourceText;
      }
      return appendElement(sourceText, member.value, value);
    }
    if (member.value.kind !== 'object') {
      throw new Error(`updateJSON5: ${keyPath.slice(0, i + 1).join('.')} is not an object`);
    }
    node = member.value;
  }

  throw new Error('updateJSON5: failed to resolve keyPath');
}

function parseObjectRoot(sourceText: string, keyPath: ReadonlyArray<string>): ObjectNode {
  if (keyPath.length === 0) {
    throw new Error('updateJSON5: keyPath must not be empty');
  }

  const root = parseDocument(sourceText);
  if (root.kind !== 'object') {
    throw new Error('updateJSON5: root value must be an object');
  }
  return root;
}

function appendElement(sourceText: string, node: ArrayNode, value: string): string {
  const lastElement = node.elements[node.elements.length - 1];
  // Match the quoting the array already uses rather than imposing this
  // module's own, since the whole array is read back as one list by eye.
  const quote =
    lastElement && lastElement.kind === 'string' ? sourceText[lastElement.start] : '"';
  const entryText = json5.stringify(value, { quote });

  if (!lastElement) {
    const inner = sourceText.slice(node.start + 1, node.end - 1);
    // An empty array holding comments keeps them; the entry goes before the
    // closing bracket rather than over them.
    return inner.trim() === ''
      ? applySplices(sourceText, [{ start: node.start + 1, end: node.end - 1, text: entryText }])
      : applySplices(sourceText, [{ start: node.end - 1, end: node.end - 1, text: `${entryText} ` }]);
  }

  return appendEntry(sourceText, node, lastElement.start, lastElement.end, entryText);
}

/**
 * Inserts `entryText` after the last item of a non-empty object or array,
 * keeping the container's comma style and indentation. `itemStart` is where the
 * last item's line indent is measured from, `itemEnd` the end of its value.
 */
function appendEntry(
  sourceText: string,
  container: ObjectNode | ArrayNode,
  itemStart: number,
  itemEnd: number,
  entryText: string,
): string {
  const isMultiline = sourceText.slice(container.start, container.end).includes('\n');
  const triviaEnd = skipTrivia(sourceText, itemEnd);
  const hasTrailingComma = sourceText[triviaEnd] === ',';
  const separator = isMultiline ? `\n${lineIndent(sourceText, itemStart)}` : ' ';

  // A comment after the last item belongs to it, so the new entry starts below
  // the whole line rather than between the item and its comment.
  const afterLine = (offset: number): number =>
    isMultiline ? endOfCommentedLine(sourceText, offset, container.end - 1) : offset;

  if (hasTrailingComma) {
    const insertAt = afterLine(triviaEnd + 1);
    return applySplices(sourceText, [
      { start: insertAt, end: insertAt, text: `${separator}${entryText},` },
    ]);
  }

  // The comma has to sit against the item it follows, so a comment between them
  // does not swallow it; the entry itself still goes below the line.
  const insertAt = afterLine(itemEnd);
  return applySplices(
    sourceText,
    insertAt > itemEnd
      ? [
          { start: itemEnd, end: itemEnd, text: ',' },
          { start: insertAt, end: insertAt, text: `${separator}${entryText}` },
        ]
      : [{ start: itemEnd, end: itemEnd, text: `,${separator}${entryText}` }],
  );
}

/**
 * The end of the line `from` sits on, when trivia between `from` and the line
 * end holds a comment; `from` itself otherwise. A block comment counts as part
 * of the line it opens on however many lines it spans, so an insertion at the
 * returned offset never lands inside one.
 */
function endOfCommentedLine(text: string, from: number, limit: number): number {
  let pos = from;
  let commentEnd = -1;
  for (;;) {
    while (pos < limit && (text[pos] === ' ' || text[pos] === '\t')) {
      pos += 1;
    }
    if (text[pos] === '/' && text[pos + 1] === '/') {
      const lineEnd = text.indexOf('\n', pos);
      commentEnd = lineEnd === -1 ? limit : lineEnd;
      break;
    } else if (text[pos] === '/' && text[pos + 1] === '*') {
      pos = text.indexOf('*/', pos + 2) + 2;
      commentEnd = pos;
    } else {
      break;
    }
  }

  if (commentEnd === -1) return from;
  const lineEnd = text.indexOf('\n', commentEnd);
  return Math.min(lineEnd === -1 ? commentEnd : lineEnd, limit);
}

function insertMember(
  sourceText: string,
  node: ObjectNode,
  keyPath: ReadonlyArray<string>,
  valueText: string,
): string {
  const entryText = `${encodeJSON5(keyPath[0])}: ${buildNestedValue(keyPath.slice(1), valueText)}`;

  if (node.members.length === 0) {
    const inner = sourceText.slice(node.start + 1, node.end - 1);
    if (inner.trim() === '') {
      return applySplices(sourceText, [
        { start: node.start + 1, end: node.end - 1, text: ` ${entryText} ` },
      ]);
    }
    // The empty object contains comments; keep them and append before the brace.
    return applySplices(sourceText, [
      { start: node.end - 1, end: node.end - 1, text: `${entryText} ` },
    ]);
  }

  const lastMember = node.members[node.members.length - 1];
  return appendEntry(sourceText, node, lastMember.keyStart, lastMember.value.end, entryText);
}

function buildNestedValue(keyPath: ReadonlyArray<string>, valueText: string): string {
  let result = valueText;
  for (let i = keyPath.length - 1; i >= 0; i -= 1) {
    result = `{ ${encodeJSON5(keyPath[i])}: ${result} }`;
  }
  return result;
}

function encodeJSON5(value: string | number | boolean | null): string {
  return json5.stringify(value, { quote: '"' });
}

function applySplices(sourceText: string, splices: Splice[]): string {
  let result = sourceText;
  [...splices]
    .sort((a, b) => b.start - a.start)
    .forEach((splice) => {
      result = result.slice(0, splice.start) + splice.text + result.slice(splice.end);
    });
  return result;
}

function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let end = lineStart;
  while (end < offset && (text[end] === ' ' || text[end] === '\t')) {
    end += 1;
  }
  return text.slice(lineStart, end);
}

function skipTrivia(text: string, from: number): number {
  let pos = from;
  while (pos < text.length) {
    const ch = text[pos];
    if (/\s/.test(ch)) {
      pos += 1;
    } else if (ch === '/' && text[pos + 1] === '/') {
      const lineEnd = text.indexOf('\n', pos);
      pos = lineEnd === -1 ? text.length : lineEnd + 1;
    } else if (ch === '/' && text[pos + 1] === '*') {
      const commentEnd = text.indexOf('*/', pos + 2);
      if (commentEnd === -1) {
        throw new Error('updateJSON5: unterminated block comment');
      }
      pos = commentEnd + 2;
    } else {
      break;
    }
  }
  return pos;
}

/**
 * Parses JSON5 into a minimal tree of source spans. The text is validated
 * with json5 first, so the scanner may assume well-formed input.
 */
function parseDocument(text: string): ValueNode {
  json5.parse(text);

  let pos = 0;

  const syntaxError = (message: string): Error =>
    new Error(`updateJSON5: ${message} at offset ${pos}`);

  const skip = (): void => {
    pos = skipTrivia(text, pos);
  };

  const parseString = (): StringNode => {
    const start = pos;
    const quote = text[pos];
    pos += 1;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '\\') {
        pos += 2;
      } else if (ch === quote) {
        pos += 1;
        return { kind: 'string', start, end: pos, value: json5.parse(text.slice(start, pos)) };
      } else {
        pos += 1;
      }
    }
    throw syntaxError('unterminated string');
  };

  const parseBare = (): BareNode => {
    const start = pos;
    while (pos < text.length && !/[\s,:\]}/]/.test(text[pos])) {
      pos += 1;
    }
    if (pos === start) {
      throw syntaxError(`unexpected character '${text[pos]}'`);
    }
    return { kind: 'bare', start, end: pos };
  };

  const parseObject = (): ObjectNode => {
    const start = pos;
    pos += 1;
    const members: ObjectNode['members'] = [];
    for (;;) {
      skip();
      if (pos >= text.length) {
        throw syntaxError('unterminated object');
      }
      if (text[pos] === '}') {
        pos += 1;
        return { kind: 'object', start, end: pos, members };
      }
      const keyStart = pos;
      const key =
        text[pos] === '"' || text[pos] === "'"
          ? parseString().value
          : text.slice(keyStart, parseBare().end);
      skip();
      if (text[pos] !== ':') {
        throw syntaxError("expected ':'");
      }
      pos += 1;
      skip();
      members.push({ key, keyStart, value: parseValue() });
      skip();
      if (text[pos] === ',') {
        pos += 1;
      } else if (text[pos] !== '}') {
        throw syntaxError("expected ',' or '}'");
      }
    }
  };

  const parseArray = (): ArrayNode => {
    const start = pos;
    pos += 1;
    const elements: ValueNode[] = [];
    for (;;) {
      skip();
      if (pos >= text.length) {
        throw syntaxError('unterminated array');
      }
      if (text[pos] === ']') {
        pos += 1;
        return { kind: 'array', start, end: pos, elements };
      }
      elements.push(parseValue());
      skip();
      if (text[pos] === ',') {
        pos += 1;
      } else if (text[pos] !== ']') {
        throw syntaxError("expected ',' or ']'");
      }
    }
  };

  const parseValue = (): ValueNode => {
    const ch = text[pos];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'") return parseString();
    return parseBare();
  };

  skip();
  return parseValue();
}
