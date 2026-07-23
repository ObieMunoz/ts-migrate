import ts from 'typescript';
import { mockPluginParams, mockDiagnostic, realPluginParams } from '../test-utils';
import explicitAnyPlugin from '../../src/plugins/explicit-any';

describe('explicit-any plugin', () => {
  it('adds explicit any', async () => {
    const text = `let somePromise: any;
somePromise.then(res1 => res1.default || res1);
somePromise.then((res2) => res2.default || res2);
let someArray: any;
someArray.forEach(({ arg1, arg2 }) => {});
function fn1(p1, p2) {}
const fn2 = function(p3, p4) {}
function f3() {
  const var1 = [];
  return var1;
}
function fn4({ arg4: { arg5, arg_6: arg6 } }) {}
function fn5(...rest) {}
const fn6 = (...rest) => {}
const fn7 = ({ id }: { id }) => {}
const {
  root_see_all_link_text: rootSeeAllLinkText,
  root_subtitle: rootSubtitle,
  root_title: rootTitle,
} = {};
function Foo({
  paramA,
  paramB,
  paramC = {},
  paramD,
} = {}) {
  return true ? paramA : paramB;
}
const { varA, varB: {
  inVarA, inVarB,
} = {} } = {};
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`let somePromise: any;
somePromise.then((res1: any) => res1.default || res1);
somePromise.then((res2: any) => res2.default || res2);
let someArray: any;
someArray.forEach(({ arg1, arg2 }: any) => {});
function fn1(p1: any, p2: any) {}
const fn2 = function(p3: any, p4: any) {}
function f3() {
  const var1: any = [];
  return var1;
}
function fn4({ arg4: { arg5, arg_6: arg6 } }: any) {}
function fn5(...rest: any[]) {}
const fn6 = (...rest: any[]) => {}
const fn7 = ({ id }: { id: any }) => {}
const {
  root_see_all_link_text: rootSeeAllLinkText,
  root_subtitle: rootSubtitle,
  root_title: rootTitle,
}: any = {};
function Foo({
  paramA,
  paramB,
  paramC = {},
  paramD,
}: any = {}) {
  return true ? paramA : paramB;
}
const { varA, varB: {
  inVarA, inVarB,
} = {} }: any = {};
`);
  });

  it('adds explicit any to this', async () => {
    const text = `\
function f1(a: any) { return this; }
const f2 = function() { return this; }
function f3() { return () => this; }
function f4() { this.a = 1; this.b = 2; }
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`\
function f1(this: any, a: any) { return this; }
const f2 = function(this: any) { return this; }
function f3(this: any) { return () => this; }
function f4(this: any) { this.a = 1; this.b = 2; }
`);
  });

  it('adds explicit any with alias', async () => {
    const text = `const var1 = [];`;

    const diagnosticFor = (str: string, code: number) =>
      mockDiagnostic(text, str, { category: ts.DiagnosticCategory.Error, code });

    const result = await explicitAnyPlugin.run(
      mockPluginParams({
        options: { anyAlias: '$TSFixMe' },
        text,
        semanticDiagnostics: [diagnosticFor('var1', 7034)],
      }),
    );

    expect(result).toBe(`const var1: $TSFixMe = [];`);
  });

  it('handles arrow functions returning object literals', async () => {
    const text = `const fn = (b) => ({});`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`const fn = (b: any) => ({});`);
  });

  it('adds explicit any to array-destructured parameters', async () => {
    const text = `export function firstOf([head, ...tail], [a, b] = []) {
  return head || a || tail.length || b;
}
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export function firstOf([head, ...tail]: any, [a, b]: any = []) {
  return head || a || tail.length || b;
}
`);
  });

  it('adds explicit any to array patterns inside object parameters', async () => {
    const text = `export function pluck({ items: [first] }) {
  return first;
}
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export function pluck({ items: [first] }: any) {
  return first;
}
`);
  });

  it('annotates the outermost pattern for object patterns nested in array patterns', async () => {
    const text = `export function pick([{ x }]) {
  return x;
}
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export function pick([{ x }]: any) {
  return x;
}
`);
  });

  it('annotates every parameter of arrows returning object literals', async () => {
    const text = `export const trackEvent = (name, payload) => ({
  type: 'TRACK',
  meta: { label: \`cart:$\${payload?.total ?? 0}\`, name },
});
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export const trackEvent = (name: any, payload: any) => ({
  type: 'TRACK',
  meta: { label: \`cart:$\${payload?.total ?? 0}\`, name },
});
`);
  });

  it('handles syntax that only TypeScript parses', async () => {
    const text = `export class Cache {
  static registry;

  static {
    Cache.registry = new Map();
  }
}

export const EMOJI_RE = /[\\p{RGI_Emoji}]/v;

export const config = { retries: 3 } satisfies Record<string, number>;

export const strip = (input) => input.replace(EMOJI_RE, '');
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
        compilerOptions: { target: ts.ScriptTarget.ESNext },
      }),
    );

    expect(result).toBe(`export class Cache {
  static registry: any;

  static {
    Cache.registry = new Map();
  }
}

export const EMOJI_RE = /[\\p{RGI_Emoji}]/v;

export const config = { retries: 3 } satisfies Record<string, number>;

export const strip = (input: any) => input.replace(EMOJI_RE, '');
`);
  });

  it('annotates exported implicit-any variables (TS7005)', async () => {
    const text = `export const xs = [];
xs.push(1);
export const grid = [[]];
grid[0].push(1);
export let x;
x = 1;
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
        compilerOptions: { strict: false, noImplicitAny: true },
      }),
    );

    expect(result).toBe(`export const xs: any[] = [];
xs.push(1);
export const grid: any[][] = [[]];
grid[0].push(1);
export let x: any;
x = 1;
`);
  });

  it('annotates exported implicit-any variables with the alias', async () => {
    const text = `export const xs = [];
xs.push(1);
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        options: { anyAlias: '$TSFixMe' },
        text,
        compilerOptions: { strict: false, noImplicitAny: true },
      }),
    );

    expect(result).toBe(`export const xs: $TSFixMe[] = [];
xs.push(1);
`);
  });

  it('leaves use-site TS7005 alone when the declaration is in another file', async () => {
    const text = `h.doThing();
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
        compilerOptions: { strict: false, noImplicitAny: true },
        extraFiles: { 'globals.ts': 'var h;\n' },
      }),
    );

    expect(result).toBe(text);
  });

  it('annotates the pattern for use-site TS7005 on a binding-element declaration', async () => {
    const text = `declare function build(): any;
function f() {
  let [acc] = build();
  acc.push(1);
  return acc;
}
export default f;
`;

    const params = await realPluginParams({ text });
    const languageService = params.getLanguageService();
    const useSite = {
      file: params.sourceFile,
      start: text.lastIndexOf('acc'),
      length: 'acc'.length,
      messageText: "Variable 'acc' implicitly has an 'any[]' type.",
      category: ts.DiagnosticCategory.Error,
      code: 7005,
    };

    const result = await explicitAnyPlugin.run({
      ...params,
      getLanguageService: () =>
        ({
          getSemanticDiagnostics: () => [useSite],
          getProgram: () => languageService.getProgram(),
        } as unknown as ts.LanguageService),
    });

    expect(result).toBe(`declare function build(): any;
function f() {
  let [acc]: any = build();
  acc.push(1);
  return acc;
}
export default f;
`);
  });

  it('annotates circular returns of recursive functions (TS7023)', async () => {
    const text = `export function fact(n: number) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
export const again = function repeat(n: number) {
  return n <= 1 ? 1 : repeat(n - 1);
};
export const fib = (n: number) => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export function fact(n: number): any {
  return n <= 1 ? 1 : n * fact(n - 1);
}
export const again = function repeat(n: number): any {
  return n <= 1 ? 1 : repeat(n - 1);
};
export const fib = (n: number): any => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
`);
  });

  it('annotates the variable for recursive unparenthesized arrows', async () => {
    const text = `const f = n => f(n - 1);
export default f;
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`const f: any = (n: any) => f(n - 1);
export default f;
`);
  });

  it('annotates circular returns of recursive object members', async () => {
    const text = `export const obj = {
  walk(n: number) {
    return n <= 0 ? 0 : obj.walk(n - 1);
  },
  climb: function (n: number) {
    return n <= 0 ? 0 : obj.climb(n - 1);
  },
  ['dive'](n: number) {
    return n <= 0 ? 0 : obj.dive(n - 1);
  },
};
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export const obj = {
  walk(n: number): any {
    return n <= 0 ? 0 : obj.walk(n - 1);
  },
  climb: function (n: number): any {
    return n <= 0 ? 0 : obj.climb(n - 1);
  },
  ['dive'](n: number): any {
    return n <= 0 ? 0 : obj.dive(n - 1);
  },
};
`);
  });

  it('annotates circular returns of recursive class members', async () => {
    const text = `export class Tree {
  depth(n: number) {
    return n <= 0 ? 0 : this.depth(n - 1);
  }
  get value() {
    return this.value;
  }
  walk = (n: number) => (n <= 0 ? 0 : this.walk(n - 1));
}
`;

    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text,
      }),
    );

    expect(result).toBe(`export class Tree {
  depth(n: number): any {
    return n <= 0 ? 0 : this.depth(n - 1);
  }
  get value(): any {
    return this.value;
  }
  walk = (n: number): any => (n <= 0 ? 0 : this.walk(n - 1));
}
`);
  });

  it('ignores diagnostics that do not map to an annotatable node', async () => {
    const text = `function f(a, a) { return a; }`;

    const result = await explicitAnyPlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'a, a', { code: 7006 })],
      }),
    );

    expect(result).toBe(text);
  });
});
