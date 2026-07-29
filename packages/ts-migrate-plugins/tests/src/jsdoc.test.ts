import { pluginRunner } from '../test-utils';
import jsDocPlugin from '../../src/plugins/jsdoc';

const run = pluginRunner(jsDocPlugin, { fileName: 'file.tsx' });

describe('jsdoc plugin, annotating from tags', () => {
  it('annotates unknown types', () => {
    const text = `\
/** @param a {?} */
function A(a) {}
/** @param b {*} */
function B(b) {}
`;

    expect(run(text)).toBe(`\
/** @param a {?} */
function A(a: any) {}
/** @param b {*} */
function B(b: any) {}
`);
  });

  it('annotates a namepath type as any', () => {
    const text = `\
/** @param a {module:store/widgets~Widget} */
function A(a) {}
/** @param b {module:store/widgets.Static} */
function B(b) {}
/** @param c {module} */
function C(c) {}
/** @type {module:store/widgets~Widget} */
const d = null;
`;

    expect(run(text)).toBe(`\
/** @param a {module:store/widgets~Widget} */
function A(a: any) {}
/** @param b {module:store/widgets.Static} */
function B(b: any) {}
/** @param c {module} */
function C(c: any) {}
/** @type {module:store/widgets~Widget} */
const d: any = null;
`);
  });

  it('annotates a namepath return type as any', () => {
    const text = `\
/** @returns {module:store/widgets~Widget} */
function A() {
  return null;
}
`;

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
/** @returns {module:store/widgets~Widget} */
function A(): any {
  return null;
}
`);
  });

  it('writes the any alias for a namepath type', () => {
    const text = `\
/** @param a {module:store/widgets~Widget} */
function A(a) {}
`;

    expect(run(text, { options: { anyAlias: '$TSFixMe' } })).toBe(`\
/** @param a {module:store/widgets~Widget} */
function A(a: $TSFixMe) {}
`);
  });

  it('considers synonym tags', () => {
    const text = `\
/** @arg a {Number} */
function A(a) {}
/** @argument b {Number} */
function B(b) {}
`;

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
/** @param a {?Number} */
function A(a: number | null) {}
`);
  });

  it('annotates non-nullable types', () => {
    const text = `\
/** @param a {!Number} */
function A(a) {}
`;

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
/** @param a {Number=} */
function A(a?: number) {}
/** @param [b] {Number} */
function B(b?: number) {}
/** @param [c] {Object} */
function C({ c }: {
    c?: object;
}) {}
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
/** @param b {number} */
function A(a) {}
`);
  });

  it('annotates return type', () => {
    const text = `\
/** @return {number} */
function A() {}
`;

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text, { fileName: 'file.ts' })).toBe(`\
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

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
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

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
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

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
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

  it('annotates async arrow functions', () => {
    const text = `\
/**
 * @param a {string}
 * @param b {number}
 */
const A = async (a, b) => a + b;
/** @param c {number} */
const B = async c => c;
/**
 * @param d {number}
 * @return {Promise<string>}
 */
const C = async d => String(d);
/**
 * @param e {number}
 * @return {Promise<string>}
 */
const D = async (e) => String(e);
`;

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
/**
 * @param a {string}
 * @param b {number}
 */
const A = async (a: string, b: number) => a + b;
/** @param c {number} */
const B = async (c: number) => c;
/**
 * @param d {number}
 * @return {Promise<string>}
 */
const C = async (d: number): Promise<string> => String(d);
/**
 * @param e {number}
 * @return {Promise<string>}
 */
const D = async (e: number): Promise<string> => String(e);
`);
  });

  it('annotates the return of a parameter list written over several lines', () => {
    const text = `\
/**
 * @param a {number}
 * @param b {number}
 * @return {string}
 */
const A = async (
  a,
  b
) => String(a + b);
`;

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
/**
 * @param a {number}
 * @param b {number}
 * @return {string}
 */
const A = async (
  a: number, b: number
): string => String(a + b);
`);
  });

  it('annotates an arrow function that is already generic', () => {
    const text = `\
/**
 * @param a {T}
 * @param b {number}
 */
const A = <T,>(a, b) => a;
`;

    expect(run(text)).toBe(`\
/**
 * @param a {T}
 * @param b {number}
 */
const A = <T,>(a: T, b: number) => a;
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

    expect(run(text, { options: { annotateReturns: true } })).toBe(`\
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

    expect(run(text)).toBe(`\
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

    expect(run(text)).toBe(`\
/** @param $1 {number} */
function A($1: number) {}
`);
  });

  it('leaves return types to inference unless the option asks for them', () => {
    const text = `\
/** @return {number} */
function A() {}
`;

    expect(run(text)).toBe(text);

    expect(
      run(text, { options: { annotateReturns: true } }),
    ).toBe(`\
/** @return {number} */
function A(): number {}
`);
  });
});

describe('jsdoc plugin, malformed types', () => {
  // TypeScript's JSDoc parser recovers from a type it cannot read by handing
  // back a partial tree. Printing that tree writes text the compiler cannot
  // parse, which leaves the whole file broken and fails the migration.
  const unnamedParam =
    '{<T extends object, K extends string>(data: T[K], { path: string[]; parent: T }) => any}';

  it('falls back to any for a @type it cannot print', () => {
    const text = `\
/** @type ${unnamedParam} */
const f = (a, b) => a;
`;

    expect(run(text)).toBe(`\
/** @type ${unnamedParam} */
const f: any = (a, b) => a;
`);
  });

  it('falls back to any for a @typedef it cannot print, keeping the name', () => {
    const text = `\
/**
 * @typedef Fn
 * @type ${unnamedParam}
 */
const x = 1;
`;

    expect(run(text)).toContain('type Fn = any;');
  });

  it('keeps the parameters it can read when one of them cannot be printed', () => {
    const text = `\
/**
 * @param {string} a
 * @param ${unnamedParam} b
 */
function f(a, b) {}
`;

    // The unreadable tag leaves its parameter alone rather than taking the
    // whole signature down with it; explicit-any annotates it later.
    expect(run(text)).toBe(`\
/**
 * @param {string} a
 * @param ${unnamedParam} b
 */
function f(a: string, b) {}
`);
  });

  it('still writes a well-formed function type', () => {
    const text = `\
/** @type {(data: string, opts: { path: string[] }) => void} */
const f = (a, b) => {};
`;

    expect(run(text)).toBe(`\
/** @type {(data: string, opts: { path: string[] }) => void} */
const f: (data: string, opts: { path: string[]; }) => void = (a, b) => {};
`);
  });
});

describe('jsdoc plugin, destructured parameters', () => {
  it('builds an object type from tags that name what the pattern binds', () => {
    const text = `\
/**
 * @param {boolean} hasSaved
 * @param {Object} applied
 */
export const f = ({ hasSaved, applied }) => !hasSaved || !applied.visible;
`;

    expect(run(text)).toBe(`\
/**
 * @param {boolean} hasSaved
 * @param {Object} applied
 */
export const f = ({ hasSaved, applied }: {
    hasSaved?: boolean;
    applied?: object;
}) => !hasSaved || !applied.visible;
`);
  });

  it('keeps a binding no tag documents readable', () => {
    const text = `\
/**
 * @param {string} text
 * @param {string} className
 */
const f = ({ text, linkClassName, ...rest }) => [text, linkClassName, rest];
`;

    expect(run(text)).toBe(`\
/**
 * @param {string} text
 * @param {string} className
 */
const f = ({ text, linkClassName, ...rest }: {
    text?: string;
    className?: string;
    linkClassName?: any;
}) => [text, linkClassName, rest];
`);
  });

  it('leaves the nested spelling to the type literal TypeScript parses it into', () => {
    const text = `\
/**
 * @param {Object} props
 * @param {string} props.text
 * @param {number} props.count
 */
const f = ({ text, count }) => [text, count];
`;

    expect(run(text)).toBe(`\
/**
 * @param {Object} props
 * @param {string} props.text
 * @param {number} props.count
 */
const f = ({ text, count }: {
    text: string;
    count: number;
}) => [text, count];
`);
  });

  it('leaves a tag that names the parameter itself alone', () => {
    const text = `\
/**
 * @param {Options} options
 */
const f = ({ a, b }) => [a, b];
`;

    expect(run(text)).toBe(`\
/**
 * @param {Options} options
 */
const f = ({ a, b }: Options) => [a, b];
`);
  });

  it('does not take the tags of a named parameter', () => {
    const text = `\
/**
 * @param {string} name
 * @param {number} count
 */
const f = (name, { count }) => [name, count];
`;

    expect(run(text)).toBe(`\
/**
 * @param {string} name
 * @param {number} count
 */
const f = (name: string, { count }: {
    count?: number;
}) => [name, count];
`);
  });
});
