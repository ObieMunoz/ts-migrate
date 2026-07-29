import { pluginRunner, typeCheck } from '../test-utils';
import jsDocPlugin from '../../src/plugins/jsdoc';

const run = pluginRunner(jsDocPlugin, { fileName: '/file.ts' });

describe('jsdoc plugin, output that type-checks', () => {
  it('type-checks the casts it converts', () => {
    const text = `\
/**
 * @typedef {Object} Row
 * @property {string} id
 */

/** @param {unknown} json */
export function read(json) {
  const row = /** @type {Row} */ (json);
  const rows = [/** @type {Row} */ (json)];
  const pair = /** @type {Row} */ (/** @type {Row} */ (json));
  const chosen = /** @type {Row} */ (json ? json : json);
  const fallback = /** @type {Row} */ (json || json);
  const made = /** @type {Row} */ (make());
  take(row);
  take(rows[0]);
  take(pair);
  take(chosen);
  take(fallback);
  take(made);
  take(/** @type {Row} */ (json));
  return row.id;
}

/** @param {Row} row */
function take(row) {
  return row.id;
}

/** @returns {unknown} */
function make() {
  return null;
}
`;

    const result = run(text, { options: { annotateReturns: true } }) as string;

    expect(result).toContain('const row = (json as Row);');
    expect(result).toContain('const pair = ((json as Row) as Row);');
    expect(result).toContain('const chosen = ((json ? json : json) as Row);');
    expect(result).toContain('const fallback = ((json || json) as Row);');
    expect(typeCheck({ '/file.ts': result })).toEqual([]);
  });

  it('type-checks the code it converts', () => {
    const text = `\
import { helper } from './helper';

/**
 * @typedef {Object} Opts
 * @property {string} name
 * @property {number} [size]
 */

/**
 * @callback Format
 * @param {Opts} opts
 * @returns {string}
 */

/**
 * @template T
 * @typedef {Object} Box
 * @property {T} value
 */

/**
 * @template T
 * @param {T} value
 * @param {Format} format
 * @param {Opts} opts
 * @returns {Box<T>}
 */
export function box(value, format, opts) {
  helper(format(opts));
  return { value };
}
`;
    const consumer = `\
import { box } from './file';

/** @param opts {import('./file').Opts} */
export function use(opts) {
  return box(1, (o) => o.name, opts);
}
`;

    const options = { annotateReturns: true };
    const files = {
      '/file.ts': run(text, { options }) as string,
      '/consumer.ts': run(consumer, { fileName: '/consumer.ts', options }) as string,
      '/helper.ts': 'export function helper(s: string): void {}\n',
    };

    expect(files['/consumer.ts']).toContain('export function use(opts: import(\'./file\').Opts)');
    expect(typeCheck(files)).toEqual([]);
  });

  it('type-checks the generic class it converts and every reference to it', () => {
    const text = `\
/**
 * @template T
 */
export class Box {
  /** @type {T} */
  value;

  /** @param {T} value */
  constructor(value) {
    this.value = value;
  }

  /** @returns {T} */
  get() {
    return this.value;
  }
}

/** @param {Box} b */
export function unwrap(b) {
  return b.get();
}
`;
    const consumer = `\
import { Box } from './file';

/** @param {Box} b */
export function bare(b) {
  return b.get();
}

/** @param {Box<string>} b */
export function typed(b) {
  /** @type {string} */
  const s = b.get();
  return s;
}

export class Crate extends Box {}

export const crate = new Crate(1);
`;

    const options = { annotateReturns: true };
    const files = {
      '/file.ts': run(text, { options }) as string,
      '/consumer.ts': run(consumer, { fileName: '/consumer.ts', options }) as string,
    };

    expect(files['/file.ts']).toContain('export class Box<T = any> {');
    expect(files['/file.ts']).toContain('get(): T {');
    expect(typeCheck(files)).toEqual([]);
  });

  it('type-checks the generic alias it converts and every reference to it', () => {
    const text = `\
/**
 * @template T
 * @typedef {Object} Wrap
 * @property {T} value
 */

/**
 * @template T
 * @callback Read
 * @param {Wrap<T>} w
 * @returns {T}
 */

/** @param {Wrap} w */
export function unwrap(w) {
  return w.value;
}
`;
    const consumer = `\
/** @param {import('./file').Wrap} w */
export function bare(w) {
  return w.value;
}

/** @param {import('./file').Wrap<string>} w */
export function typed(w) {
  /** @type {string} */
  const s = w.value;
  return s;
}

/** @param {import('./file').Read} r */
export function read(r) {
  return r({ value: 1 });
}
`;

    const options = { annotateReturns: true };
    const files = {
      '/file.ts': run(text, { options }) as string,
      '/consumer.ts': run(consumer, { fileName: '/consumer.ts', options }) as string,
    };

    expect(files['/file.ts']).toContain('export type Wrap<T = any> = {');
    expect(files['/file.ts']).toContain('export type Read<T = any> = (w: Wrap<T>) => T;');
    expect(files['/file.ts']).toContain('export function unwrap(w: Wrap) {');
    expect(files['/consumer.ts']).toContain("w: import('./file').Wrap<string>");
    expect(typeCheck(files)).toEqual([]);
  });

  it('type-checks the namepath types it converts', () => {
    const text = `\
/** @typedef {module:store/widgets~Widget} Widget */

/**
 * @param {module:store/widgets~Widget} widget
 * @param {module} mod
 * @returns {module:store/widgets~Widget}
 */
export function find(widget, mod) {
  /** @type {module:store/widgets~Widget} */
  const found = widget[mod];
  return found;
}
`;

    const result = run(text, { options: { annotateReturns: true } }) as string;

    expect(result).toContain('export function find(widget: any, mod: any): any {');
    expect(typeCheck({ '/file.ts': result })).toEqual([]);
  });
});
