import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { mockPluginParams, pluginRunner, withoutMarkers } from '../test-utils';
import jsDocPlugin from '../../src/plugins/jsdoc';

const run = pluginRunner(jsDocPlugin, { fileName: 'file.ts' });

describe('jsdoc plugin, inline type casts', () => {
  it('converts an inline type cast into an as expression', () => {
    const text = `\
const a = /** @type {Row} */ (json);
const o = { row: /** @type {Row} */ (json) };
take(/** @type {Row} */ (json));

function pick() {
  return /** @type {Row} */ (json);
}

const nested = /** @type {Row} */ (/** @type {string} */ (json));

const multiline =
  /** @type {Row} */
  (json);
`;

    expect(run(text)).toBe(`\
const a = (json as Row);
const o = { row: (json as Row) };
take((json as Row));

function pick() {
  return (json as Row);
}

const nested = ((json as string) as Row);

const multiline =
  (json as Row);
`);
  });

  it('parenthesizes a cast operand that binds less tightly than as', () => {
    const text = `\
const a = /** @type {number} */ (x || y);
const b = /** @type {number} */ (x ? y : z);
const c = /** @type {number} */ (x + y);
const d = /** @type {number} */ (x.y);
const e = /** @type {Fn} */ (() => x);
`;

    expect(run(text)).toBe(`\
const a = ((x || y) as number);
const b = ((x ? y : z) as number);
const c = (x + y as number);
const d = (x.y as number);
const e = ((() => x) as Fn);
`);
  });

  it('leaves a cast that is assigned to or deleted', () => {
    const text = `\
/** @type {Row} */ (obj.row) = value;
delete /** @type {Row} */ (obj.row);
[/** @type {Row} */ (obj.row)] = rows;
/** @type {Row} */ (obj.row)++;
`;
    const notices: PluginFileNotice[] = [];

    const result = run(text, { reportFileNotice: (n) => notices.push(n) });

    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices).toEqual([
      {
        reason: '@type {Row} stays a comment because the cast is an assignment target',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
      {
        reason:
          '@type {Row} stays a comment because delete takes a property reference and not an assertion',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
      {
        reason: '@type {Row} stays a comment because the cast is an assignment target',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
      {
        reason: '@type {Row} stays a comment because the cast is an assignment target',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
    ]);
  });

  it('leaves an expression whose only comment annotates the statement', () => {
    const text = `\
/** @type {Row | undefined} */
let a = (obj.row = undefined);

/** @type {Ids} */
const b = (map[
  /** @type {Id} */
  (chunk.id)
] = []);

const o = {
  /** @type {Row} */
  row: (json),
};

/** @type {Row} */
function f() {
  return (json);
}
`;

    expect(run(text)).toBe(`\
/** @type {Row | undefined} */
let a: Row | undefined = (obj.row = undefined);

/** @type {Ids} */
const b: Ids = (map[
  (chunk.id as Id)
] = []);

const o = {
  /** @type {Row} */
  row: (json),
};

/** @type {Row} */
function f() {
  return (json);
}
`);
  });

  it('leaves a cast in a parameter list the tags rewrite', () => {
    const text = `\
/** @param {Row} a */
function f(a = /** @type {Row} */ (json)) {}

/** @param {Row} a */
const g = (a = /** @type {Row} */ (json)) => a;

function h(a = /** @type {Row} */ (json)) {}

/** @returns {Row} */
function i(a = /** @type {Row} */ (json)) {
  return a;
}
`;
    const notices: PluginFileNotice[] = [];

    const result = run(text, { options: { annotateReturns: true }, reportFileNotice: (n) => notices.push(n) });

    expect(withoutMarkers(result as string)).toBe(`\
/** @param {Row} a */
function f(a: Row = (json)) {}

/** @param {Row} a */
const g = (a: Row = (json)) => a;

function h(a = (json as Row)) {}

/** @returns {Row} */
function i(a = (json as Row)): Row {
  return a;
}
`);
    expect(notices).toEqual([
      {
        reason:
          '@type {Row} stays a comment because the parameter list it sits in is written out again from its own tags',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
      {
        reason:
          '@type {Row} stays a comment because the parameter list it sits in is written out again from its own tags',
        hint:
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
          'without the comment.',
        recovered: true,
        marked: true,
      },
    ]);
  });

  it('leaves an as expression the comment already documents', () => {
    const text = `\
const a = /** @type {Row} */ (json);
const b = /** @type {Row} */ (json as Row);
const c = /** @type {Row} */ (<Row>json);
`;
    const params = { fileName: 'file.ts' };

    const once = jsDocPlugin.run(mockPluginParams({ ...params, text })) as string;
    const twice = jsDocPlugin.run(mockPluginParams({ ...params, text: once }));

    expect(once).toBe(`\
const a = (json as Row);
const b = /** @type {Row} */ (json as Row);
const c = /** @type {Row} */ (<Row>json);
`);
    expect(twice).toBe(once);
  });

  it('applies the type map and the any alias to a cast', () => {
    const text = `\
/** @typedef {string} Key */
class Key {}

const a = /** @type {Number} */ (json);
const b = /** @type {promise} */ (json);
const c = /** @type {Key} */ (json);
const d = /** @type {*} */ (json);
`;

    const result = run(text, { options: { anyAlias: '$TSFixMe' } });

    expect(withoutMarkers(result as string)).toBe(`\
/** @typedef {string} Key */
class Key {}

const a = (json as number);
const b = (json as Promise<$TSFixMe>);
const c = (json as $TSFixMe);
const d = (json as $TSFixMe);
`);
  });
});
