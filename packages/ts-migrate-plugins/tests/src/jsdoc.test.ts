import ts from 'typescript';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { mockPluginParams } from '../test-utils';
import jsDocPlugin from '../../src/plugins/jsdoc';

/** Compiles the given files in memory, resolving the lib files from disk. */
function typeCheck(files: { [fileName: string]: string }): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = files[fileName] ?? ts.sys.readFile(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName in files || ts.sys.fileExists(fileName),
    readFile: (fileName) => files[fileName] ?? ts.sys.readFile(fileName),
  };
  const program = ts.createProgram(Object.keys(files), options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
  );
}

describe('jsdoc plugin', () => {
  it('annotates unknown types', () => {
    const text = `\
/** @param a {?} */
function A(a) {}
/** @param b {*} */
function B(b) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {?} */
function A(a: any) {}
/** @param b {*} */
function B(b: any) {}
`);
  });

  it('considers synonym tags', () => {
    const text = `\
/** @arg a {Number} */
function A(a) {}
/** @argument b {Number} */
function B(b) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @arg a {Number} */
function A(a: number) {}
/** @argument b {Number} */
function B(b: number) {}
`);
  });

  it('annotates simple type references', () => {
    const text = `\
/** @param a {Number} */
function A(a) {}
/** @param b {String} */
function B(b) {}
/** @param c {Boolean} */
function C(c) {}
/** @param d {Object} */
function D(d) {}
/** @param e {date} */
function E(e) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Number} */
function A(a: number) {}
/** @param b {String} */
function B(b: string) {}
/** @param c {Boolean} */
function C(c: boolean) {}
/** @param d {Object} */
function D(d: object) {}
/** @param e {date} */
function E(e: Date) {}
`);
  });

  it('ignores nonsensical type parameters', () => {
    const text = `\
/** @param a {Number<string>} */
function A(a) {}
/** @param b {String<string>} */
function B(b) {}
/** @param c {Boolean<string>} */
function C(c) {}
/** @param d {Object<object>} */
function D(d) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Number<string>} */
function A(a: number) {}
/** @param b {String<string>} */
function B(b: string) {}
/** @param c {Boolean<string>} */
function C(c: boolean) {}
/** @param d {Object<object>} */
function D(d: object) {}
`);
  });

  it('annotates nullable types', () => {
    const text = `\
/** @param a {?Number} */
function A(a) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {?Number} */
function A(a: number | null) {}
`);
  });

  it('annotates non-nullable types', () => {
    const text = `\
/** @param a {!Number} */
function A(a) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {!Number} */
function A(a: number) {}
`);
  });

  it('annotates optional types', () => {
    const text = `\
/** @param a {Number=} */
function A(a) {}
/** @param [b] {Number} */
function B(b) {}
/** @param [c] {Object} */
function C({ c }) {}
/** @param [d] {Number} */
function D(d = 1) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Number=} */
function A(a?: number) {}
/** @param [b] {Number} */
function B(b?: number) {}
/** @param [c] {Object} */
function C({ c }: object) {}
/** @param [d] {Number} */
function D(d: number = 1) {}
`);
  });

  it('annotates parameterized types', () => {
    const text = `\
/** @param a {Array} */
function A(a) {}
/** @param b {Array<String>} */
function B(b) {}
/** @param c {Array.<String>} */
function C(c) {}
/** @param d {String[]} */
function D(d) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Array} */
function A(a: Array<any>) {}
/** @param b {Array<String>} */
function B(b: Array<string>) {}
/** @param c {Array.<String>} */
function C(c: Array<string>) {}
/** @param d {String[]} */
function D(d: string[]) {}
`);
  });

  it('annotates object index types', () => {
    const text = `\
/** @param a {Object<number, any>} */
function A(a) {}
/** @param b {Object<string, any>} */
function B(b) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Object<number, any>} */
function A(a: { [n: number]: any; }) {}
/** @param b {Object<string, any>} */
function B(b: { [s: string]: any; }) {}
`);
  });

  it('annotates function types', () => {
    const text = `\
/** @param a {function(number)} */
function A(a) {}
/** @param b {function(): number} */
function B(b) {}
/** @param c {function(this: number)} */
function C(c) {}
/** @param d {function(...number)} */
function D(d) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {function(number)} */
function A(a: (arg0: number) => any) {}
/** @param b {function(): number} */
function B(b: () => number) {}
/** @param c {function(this: number)} */
function C(c: (this: number) => any) {}
/** @param d {function(...number)} */
function D(d: (...rest: number[]) => any) {}
`);
  });

  it('annotates documented properties', () => {
    const text = `\
/**
 * @param {Object} employee
 * @param {string} employee.name
 * @param {string} [employee.department]
 */
function Project(employee) {}
/**
 * @param {Object} employee
 * @param employee.name
 * @param employee.department
 */
function NoTypes(employee) {}
/**
 * @param {Object} employee
 * @param {Object} employee.name
 * @param {string} employee.name.first
 */
function DeepNesting(employee) {}
/**
 * @param {Object} param
 * @param {String} param.a
 * @param {Number} param.b
 */
function Destructured({ a, b }) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/**
 * @param {Object} employee
 * @param {string} employee.name
 * @param {string} [employee.department]
 */
function Project(employee: {
    name: string;
    department?: string;
}) {}
/**
 * @param {Object} employee
 * @param employee.name
 * @param employee.department
 */
function NoTypes(employee: {
    name: any;
    department: any;
}) {}
/**
 * @param {Object} employee
 * @param {Object} employee.name
 * @param {string} employee.name.first
 */
function DeepNesting(employee: {
    name: {
        first: string;
    };
}) {}
/**
 * @param {Object} param
 * @param {String} param.a
 * @param {Number} param.b
 */
function Destructured({ a, b }: {
    a: string;
    b: number;
}) {}
`);
  });

  it('annotates undeclared types', () => {
    const text = `\
/** @param a {Undeclared} */
function A(a) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {Undeclared} */
function A(a: Undeclared) {}
`);
  });

  it('annotates partially-documented functions', () => {
    const text = `\
/**
 * @param a {number}
 * @param b {string}
 */
function A(a, b, c) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/**
 * @param a {number}
 * @param b {string}
 */
function A(a: number, b: string, c) {}
`);
  });

  it('handles misdocumented parameters', () => {
    const text = `\
/** @param b {number} */
function A(a) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param b {number} */
function A(a) {}
`);
  });

  it('annotates return type', () => {
    const text = `\
/** @return {number} */
function A() {}
`;

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
/** @return {number} */
function A(): number {}
`);
  });

  it('does not overwrite existing annotations', () => {
    const text = `\
/** @param a {number} */
function A(a: string) {}
/** @return {number} */
function B(): string {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param a {number} */
function A(a: string) {}
/** @return {number} */
function B(): string {}
`);
  });

  it('annotates class methods', () => {
    const text = `\
class C {
  /** @param a {number} */
  A(a) {}
}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
class C {
  /** @param a {number} */
  A(a: number) {}
}
`);
  });

  it('adds accessibility modifiers to class methods', () => {
    const text = `\
class C {
  /** @private */
  A() {}
  /** @protected */
  B() {}
  /** @public */
  C() {}
  /**
   * @private
   * @protected
   * @public
   */
  D() {}
  /** @public */
  private E() {}
}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
class C {
  /** @private */
  private A() {}
  /** @protected */
  protected B() {}
  /** @public */
  public C() {}
  /**
   * @private
   * @protected
   * @public
   */
  private D() {}
  /** @public */
  private E() {}
}
`);
  });

  it('adds an accessibility modifier before the modifiers a method already has', () => {
    const text = `\
class C {
  /**
   * @param {Number} a
   * @private
   */
  static A(a) {}
  /** @protected */
  async B() {}
  /** @private */
  @dec
  C() {}
}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
class C {
  /**
   * @param {Number} a
   * @private
   */
  private static A(a: number) {}
  /** @protected */
  protected async B() {}
  /** @private */
  @dec
  private C() {}
}
`);
  });

  it('annotates object literal methods', () => {
    const text = `\
const O = {
  /** @param a {number} */
  A(a) {},
  /** @return {string} */
  B() {},
  /** @private */
  C() {},
  /** @param a {number} */
  D: (a) => {},
  /** @return {string} */
  E: () => {}
};
`;

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
const O = {
  /** @param a {number} */
  A(a: number) {},
  /** @return {string} */
  B(): string {},
  /** @private */
  C() {},
  /** @param a {number} */
  D: (a: number) => {},
  /** @return {string} */
  E: (): string => {}
};
`);
  });

  it('annotates function expressions', () => {
    const text = `\
/** @param a {number} */
const A = function(a) {};
/** @return {string} */
const B = function() {};
/** @param c {number} */
window.c = function(c) {};
`;

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
/** @param a {number} */
const A = function(a: number) {};
/** @return {string} */
const B = function(): string {};
/** @param c {number} */
window.c = function(c: number) {};
`);
  });

  it('annotates arrow functions', () => {
    const text = `\
/** @param a {number} */
const A = (a) => null;
/** @return {string} */
const B = (b) => null;
/** @param c {number} */
const C = c => null;
/** @return {string} */
const D = d => null;
/** @param e {number} */
window.e = (e) => null;
`;

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
/** @param a {number} */
const A = (a: number) => null;
/** @return {string} */
const B = (b): string => null;
/** @param c {number} */
const C = (c: number) => null;
/** @return {string} */
const D = (d): string => null;
/** @param e {number} */
window.e = (e: number) => null;
`);
  });

  it('parenthesizes an arrow function once when it annotates both ends', () => {
    const text = `\
/**
 * @param a {number}
 * @return {string}
 */
const A = a => String(a);
`;

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
/**
 * @param a {number}
 * @return {string}
 */
const A = (a: number): string => String(a);
`);
  });

  it('annotates functions that are not at the top level', () => {
    const text = `\
function() {
    /** @param a {number} */
    function A(a) {}
}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
function() {
    /** @param a {number} */
    function A(a: number) {}
}
`);
  });

  it('preserves $-prefixed parameter names', () => {
    const text = `\
/** @param $1 {number} */
function A($1) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }));

    expect(result).toBe(`\
/** @param $1 {number} */
function A($1: number) {}
`);
  });

  it('leaves return types to inference unless the option asks for them', () => {
    const text = `\
/** @return {number} */
function A() {}
`;

    expect(jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }))).toBe(text);

    expect(
      jsDocPlugin.run(
        mockPluginParams({ text, fileName: 'file.tsx', options: { annotateReturns: true } }),
      ),
    ).toBe(`\
/** @return {number} */
function A(): number {}
`);
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

  it('drops a comment that only declares a typedef', () => {
    const text = `\
/** @typedef {string | number} Key */
/** @param k {Key} */
function f(k) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.ts', options: { annotateReturns: true } }),
    );

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.ts', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(
      mockPluginParams({
        text,
        fileName: 'file.ts',
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    expect(result).toBe(`\
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
        hint: 'Members that reference it keep the name the comment declared.',
        recovered: true,
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(
      mockPluginParams({ text, fileName: 'file.ts', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`\
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

    expect(jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.tsx' }))).toBe(`\
/**
 * @template T
 * @param {T} v
 */
const identity = <T,>(v: T) => v;
`);

    expect(jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }))).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(
      mockPluginParams({
        text,
        fileName: 'file.ts',
        options: { anyAlias: '$TSFixMe' },
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    expect(result).toBe(`\
class Key {}

/** @typedef {string} Key */

/** @param k {Key} */
function f(k: $TSFixMe) {}
`);
    expect(notices).toEqual([
      {
        reason: '@typedef Key stays a comment because the file already declares that name',
        hint: 'References to it are annotated with any.',
        recovered: true,
      },
    ]);
  });

  it('falls back to any for a typedef with a qualified name', () => {
    const text = `\
/** @typedef {string} NS.Key */

/** @param k {NS.Key} */
function f(k) {}
`;

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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

    const result = jsDocPlugin.run(mockPluginParams({ text, fileName: 'file.ts' }));

    expect(result).toBe(`\
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
      '/file.ts': jsDocPlugin.run(
        mockPluginParams({ text, fileName: '/file.ts', options }),
      ) as string,
      '/consumer.ts': jsDocPlugin.run(
        mockPluginParams({ text: consumer, fileName: '/consumer.ts', options }),
      ) as string,
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
      '/file.ts': jsDocPlugin.run(
        mockPluginParams({ text, fileName: '/file.ts', options }),
      ) as string,
      '/consumer.ts': jsDocPlugin.run(
        mockPluginParams({ text: consumer, fileName: '/consumer.ts', options }),
      ) as string,
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
      '/file.ts': jsDocPlugin.run(
        mockPluginParams({ text, fileName: '/file.ts', options }),
      ) as string,
      '/consumer.ts': jsDocPlugin.run(
        mockPluginParams({ text: consumer, fileName: '/consumer.ts', options }),
      ) as string,
    };

    expect(files['/file.ts']).toContain('export type Wrap<T = any> = {');
    expect(files['/file.ts']).toContain('export type Read<T = any> = (w: Wrap<T>) => T;');
    expect(files['/file.ts']).toContain('export function unwrap(w: Wrap) {');
    expect(files['/consumer.ts']).toContain("w: import('./file').Wrap<string>");
    expect(typeCheck(files)).toEqual([]);
  });
});
