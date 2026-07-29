import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { pluginRunner, typeCheck, withoutMarkers } from '../test-utils';
import jsDocPlugin from '../../src/plugins/jsdoc';

const run = pluginRunner(jsDocPlugin, { fileName: 'file.ts' });

describe('jsdoc plugin, typedef, callback and template tags', () => {
  it('keeps the return type a signature already declares while annotating its parameters', () => {
    const text = `\
/**
 * @param {number} [d=1] - the default
 * @returns {number} out
 */
export function f(d = 1): number {
  return d;
}

/** @param {string} [s=''] - the default */
export const g = (s = ''): void => {
  void s;
};

export class C {
  /** @param {string} [s=''] - the default */
  public m(s = ''): this {
    void s;
    return this;
  }
}
`;

    const expected = `\
/**
 * @param {number} [d=1] - the default
 * @returns {number} out
 */
export function f(d: number = 1): number {
  return d;
}

/** @param {string} [s=''] - the default */
export const g = (s: string = ''): void => {
  void s;
};

export class C {
  /** @param {string} [s=''] - the default */
  public m(s: string = ''): this {
    void s;
    return this;
  }
}
`;

    const result = run(text, { fileName: '/file.ts' });
    expect(result).toBe(expected);
    expect(typeCheck({ '/file.ts': result })).toEqual([]);

    // The option only decides whether an undeclared return type is written.
    expect(
      run(text, { fileName: '/file.ts', options: { annotateReturns: true } }),
    ).toBe(expected);
  });

  it('converts a typedef into a type alias and keeps the description', () => {
    const text = `\
/**
 * Options for the thing.
 * @typedef {Object} Opts
 * @property {string} a
 * @property {number} [b]
 */

/** @param opts {Opts} */
function run(opts) {}
`;

    expect(run(text)).toBe(`\
/**
 * Options for the thing.
 */
type Opts = {
    a: string;
    b?: number;
};

/** @param opts {Opts} */
function run(opts: Opts) {}
`);
  });

  it('declares a namepath typedef and property as any', () => {
    const text = `\
/** @typedef {module:store/widgets~Widget} Widget */

/**
 * @typedef {Object} Holder
 * @property {module:store/widgets~Widget} widget
 */
`;

    expect(run(text)).toBe(`\
type Widget = any;

type Holder = {
    widget: any;
};
`);
  });

  it('drops a comment that only declares a typedef', () => {
    const text = `\
/** @typedef {string | number} Key */
/** @param k {Key} */
function f(k) {}
`;

    expect(run(text)).toBe(`\
type Key = string | number;
/** @param k {Key} */
function f(k: Key) {}
`);
  });

  it('keeps a comment that also documents its host', () => {
    const text = `\
/**
 * @typedef {string} Key
 * @param k {Key}
 */
function f(k) {}
`;

    expect(run(text)).toBe(`\
type Key = string;
/**
 * @typedef {string} Key
 * @param k {Key}
 */
function f(k: Key) {}
`);
  });

  it('converts a callback into a function type alias', () => {
    const text = `\
/**
 * @callback Handler
 * @param {string} key
 * @param {number} [count]
 * @param {...boolean} rest
 * @returns {boolean}
 */

/** @param h {Handler} */
function on(h) {}
`;

    expect(run(text)).toBe(`\
type Handler = (key: string, count?: number, ...rest: boolean[]) => boolean;

/** @param h {Handler} */
function on(h: Handler) {}
`);
  });

  it('converts templates into type parameters', () => {
    const text = `\
/**
 * @template T
 * @typedef {Object} Box
 * @property {T} value
 */

/**
 * @template {string} K
 * @param {K} key
 * @returns {Box<K>}
 */
function box(key) {
  return { value: key };
}
`;

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
type Box<T = any> = {
    value: T;
};

/**
 * @template {string} K
 * @param {K} key
 * @returns {Box<K>}
 */
function box<K extends string>(key: K): Box<K> {
  return { value: key };
}
`);
  });

  it('converts templates on a class into type parameters', () => {
    const text = `\
/**
 * @template T
 * @template {string} K
 * @template [D=number]
 */
export class Box extends Base {
  /**
   * @param {T} value
   * @param {K} key
   * @param {D} depth
   */
  add(value, key, depth) {}
}
`;

    expect(run(text)).toBe(`\
/**
 * @template T
 * @template {string} K
 * @template [D=number]
 */
export class Box<T = any, K extends string = any, D = number> extends Base {
  /**
   * @param {T} value
   * @param {K} key
   * @param {D} depth
   */
  add(value: T, key: K, depth: D) {}
}
`);
  });

  it('writes the any alias as the type parameter default', () => {
    const text = `\
/**
 * @template T
 */
const Box = class Inner {
  /** @param {T} v */
  add(v) {}
};
`;

    expect(run(text, { options: { anyAlias: '$TSFixMe' } })).toBe(`\
/**
 * @template T
 */
const Box = class Inner<T = $TSFixMe> {
  /** @param {T} v */
  add(v: T) {}
};
`);
  });

  it('leaves a class that declares its own type parameters', () => {
    const text = `\
/**
 * @template T
 */
class Box<U> {
  /** @param {U} v */
  add(v) {}
}
`;

    expect(run(text)).toBe(`\
/**
 * @template T
 */
class Box<U> {
  /** @param {U} v */
  add(v: U) {}
}
`);
  });

  it('reports a template on a class with no name', () => {
    const text = `\
/**
 * @template T
 */
export default class {
  /** @param {T} v */
  add(v) {}
}
`;
    const notices: PluginFileNotice[] = [];

    expect(run(text, { reportFileNotice: (notice) => notices.push(notice) })).toBe(`\
// TODO(ts-migrate): Name the class so the type parameters can be written on it; members that
// reference them keep the name the comment declared.
// @template T stays a comment because the class has no name
/**
 * @template T
 */
export default class {
  /** @param {T} v */
  add(v: T) {}
}
`);
    expect(notices).toEqual([
      {
        reason: '@template T stays a comment because the class has no name',
        hint:
          'Name the class so the type parameters can be written on it; members that reference ' +
          'them keep the name the comment declared.',
        recovered: true,
        marked: true,
      },
    ]);
  });

  it('leaves a template that belongs to a typedef off the class it documents', () => {
    const text = `\
/**
 * @template T
 * @typedef {Object} Wrap
 * @property {T} value
 */
class Box {}
`;

    expect(run(text)).toBe(`\
type Wrap<T = any> = {
    value: T;
};
class Box {}
`);
  });

  it('keeps the default a template tag writes on an alias', () => {
    const text = `\
/**
 * @template [T=string]
 * @template U
 * @typedef {Object} Wrap
 * @property {T} value
 * @property {U} extra
 */
`;

    expect(run(text, { options: { anyAlias: '$TSFixMe' } })).toBe(`\
type Wrap<T = string, U = $TSFixMe> = {
    value: T;
    extra: U;
};
`);
  });

  it('adds a trailing comma to type parameters of an arrow function in a tsx file', () => {
    const text = `\
/**
 * @template T
 * @param {T} v
 */
const identity = (v) => v;
`;

    expect(run(text, { fileName: 'file.tsx' })).toBe(`\
/**
 * @template T
 * @param {T} v
 */
const identity = <T,>(v: T) => v;
`);

    expect(run(text)).toBe(`\
/**
 * @template T
 * @param {T} v
 */
const identity = <T>(v: T) => v;
`);
  });

  it('exports the aliases of a module', () => {
    const text = `\
import { helper } from './helper';

/** @typedef {string} Key */

/** @param k {Key} */
export function f(k) {
  helper(k);
}
`;

    expect(run(text)).toBe(`\
import { helper } from './helper';

export type Key = string;

/** @param k {Key} */
export function f(k: Key) {
  helper(k);
}
`);
  });

  it('hoists a typedef declared in a nested scope', () => {
    const text = `\
function outer() {
  /**
   * @typedef {Object} Inner
   * @property {boolean} z
   */
  /** @param i {Inner} */
  function inner(i) {}
  return inner;
}
`;

    expect(run(text)).toBe(`\
type Inner = {
    z: boolean;
};
function outer() {
  /**
   * @typedef {Object} Inner
   * @property {boolean} z
   */
  /** @param i {Inner} */
  function inner(i: Inner) {}
  return inner;
}
`);
  });

  it('falls back to the any alias for a typedef it cannot convert', () => {
    const text = `\
class Key {}

/** @typedef {string} Key */

/** @param k {Key} */
function f(k) {}
`;
    const notices: PluginFileNotice[] = [];

    const result = run(text, { options: { anyAlias: '$TSFixMe' }, reportFileNotice: (notice) => notices.push(notice) });

    expect(withoutMarkers(result as string)).toBe(`\
class Key {}

/** @typedef {string} Key */

/** @param k {Key} */
function f(k: $TSFixMe) {}
`);
    expect(notices).toEqual([
      {
        reason: '@typedef Key stays a comment because the file already declares that name',
        hint: 'Declare it as a type of its own; references to it are annotated with any.',
        recovered: true,
        marked: true,
      },
    ]);
  });

  it('falls back to any for a typedef with a qualified name', () => {
    const text = `\
/** @typedef {string} NS.Key */

/** @param k {NS.Key} */
function f(k) {}
`;

    const result = run(text);

    expect(withoutMarkers(result as string)).toBe(`\
/** @typedef {string} NS.Key */

/** @param k {NS.Key} */
function f(k: any) {}
`);
  });

  it('converts a file that only declares typedefs', () => {
    const text = `\
/**
 * @typedef {Object} Row
 * @property {string} id
 * @property {Object} meta
 * @property {number} meta.size
 */
`;

    expect(run(text)).toBe(`\
type Row = {
    id: string;
    meta: {
        size: number;
    };
};
`);
  });

  it('annotates variables and class properties from @type', () => {
    const text = `\
/** @type {number} */
const a = 1;
/** @type {string} */
let b;

class C {
  /** @type {string[]} */
  s;

  /** @type {number} */
  n = 0;

  /** @type {boolean} */
  t: boolean = false;
}
`;

    expect(run(text)).toBe(`\
/** @type {number} */
const a: number = 1;
/** @type {string} */
let b: string;

class C {
  /** @type {string[]} */
  s: string[];

  /** @type {number} */
  n: number = 0;

  /** @type {boolean} */
  t: boolean = false;
}
`);
  });
});
