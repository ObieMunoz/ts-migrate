import fs from 'fs';
import ts from 'typescript';
import type { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { createTmpDir } from '@obiemunoz/ts-migrate-test-utils';
import { midRunProject, realPluginParams, typeCheck } from '../test-utils';
import inferTypesPlugin from '../../src/plugins/infer-types';
import explicitAnyPlugin from '../../src/plugins/explicit-any';

describe('infer-types plugin', () => {
  it('infers parameter types from call sites', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
`);
  });

  it('infers parameter types from usage within the function body', async () => {
    const text = `function greet(name) {
  return 'hello ' + name.toUpperCase();
}
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function greet(name: string) {
  return 'hello ' + name.toUpperCase();
}
`);
  });

  it('infers rest parameter types from call sites', async () => {
    const text = `function sum(...rest) {}
sum(1, 2, 3);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function sum(...rest: number[]) {}
sum(1, 2, 3);
`);
  });

  it('parenthesizes single arrow parameters when annotating', async () => {
    const text = `declare const somePromise: any;
somePromise.then(res1 => res1.default || res1);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`declare const somePromise: any;
somePromise.then((res1: { default: any; }) => res1.default || res1);
`);
  });

  it('annotates setter parameters once', async () => {
    const text = `class C {
  set val(v) {}
}
const c = new C();
c.val = 42;
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`class C {
  set val(v: number) {}
}
const c = new C();
c.val = 42;
`);
  });

  it('leaves parameters alone when inference falls back to any', async () => {
    const text = `function noInfo(mystery) {
  return mystery;
}
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('leaves this parameters alone when inference falls back to any', async () => {
    const text = `function f4() { this.a = 1; }
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('rewrites inferred empty object types to any', async () => {
    const text = `function track(event) {
  return event.name;
}
track({ name: 'add', metadata: {} });
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function track(event: { name: any; metadata?: any; }) {
  return event.name;
}
track({ name: 'add', metadata: {} });
`);
  });

  it('drops annotations that reduce to plain any after the empty object rewrite', async () => {
    const text = `function mergeConfig(base, overrides) {
  return { ...base, overrides };
}
mergeConfig({ id: 1 }, {});
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function mergeConfig(base: { id: number; }, overrides) {
  return { ...base, overrides };
}
mergeConfig({ id: 1 }, {});
`);
  });

  it('rewrites inferred never arrays to any arrays', async () => {
    const text = `function track(event) {
  return event.name;
}
track({ name: 'add', tags: [] });
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function track(event: { name: any; tags?: any[]; }) {
  return event.name;
}
track({ name: 'add', tags: [] });
`);
  });

  it('rewrites undefined arrays from empty literals when strictNullChecks is off', async () => {
    const text = `function track(event) {
  return event.name;
}
track({ name: 'add', tags: [] });
`;

    const result = await inferTypesPlugin.run(
      await realPluginParams({ text, compilerOptions: { strict: false, noImplicitAny: true } }),
    );

    expect(result).toBe(`function track(event: { name: any; tags?: any[]; }) {
  return event.name;
}
track({ name: 'add', tags: [] });
`);
  });

  it('keeps undefined arrays backed by real elements under strictNullChecks', async () => {
    const text = `function track(event) {
  return event.name;
}
track({ name: 'add', tags: [undefined] });
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function track(event: { name: any; tags?: undefined[]; }) {
  return event.name;
}
track({ name: 'add', tags: [undefined] });
`);
  });

  it('leaves parameters alone when inference sees only an empty array', async () => {
    const text = `function buildList(items) {
  return items;
}
buildList([]);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('leaves string literals containing an empty brace pair intact', async () => {
    const text = `function keep(o) {
  return o;
}
keep({ '{}': 1, real: {} });
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function keep(o: { '{}': number; real: any; }) {
  return o;
}
keep({ '{}': 1, real: {} });
`);
  });

  it('is a no-op on files without implicit anys', async () => {
    const text = `const x: number = 1;
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('infers from usage suggestions when noImplicitAny is off', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
`;

    const result = await inferTypesPlugin.run(
      await realPluginParams({ text, compilerOptions: { strict: false, noImplicitAny: false } }),
    );

    expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
`);
  });

  it('never runs the suggestion scan on the project service', async () => {
    const params = await realPluginParams({
      text: `function add(a, b) {
  return a + b;
}
add(1, 2);
`,
      compilerOptions: { strict: false, noImplicitAny: false },
    });
    // The code-fix pass computes suggestion diagnostics internally; a separate
    // gating scan would double that work.
    const suggestionScan = jest.spyOn(params.getLanguageService(), 'getSuggestionDiagnostics');

    const result = await inferTypesPlugin.run(params);

    expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
`);
    expect(suggestionScan).not.toHaveBeenCalled();
  });

  it('keeps consistent call-site inference', async () => {
    const text = `function logId(id) {
  console.log(id);
}
logId(42);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function logId(id: number) {
  console.log(id);
}
logId(42);
`);
  });

  it('does not let an improper caller widen a body-derived type', async () => {
    const text = `function greet(name) {
  return name.toUpperCase();
}
greet('bob');
greet(42);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // The improper call site becomes a type error for ts-ignore to flag.
    expect(result).toBe(`function greet(name: string) {
  return name.toUpperCase();
}
greet('bob');
greet(42);
`);
  });

  it('does not let an improper caller override a structural body demand', async () => {
    const text = `function fire(h) {
  h.onReady();
}
fire(42);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function fire(h: { onReady: () => void; }) {
  h.onReady();
}
fire(42);
`);
  });

  it('drops inference when callers conflict and the body decides nothing', async () => {
    const text = `function logId(id) {
  console.log(id);
}
logId(42);
logId({ name: 'outlier' });
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('drops inference the body cannot express instead of suppressing inside it', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
add(1, '2');
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('drops only the parameter whose inferred type its own body contradicts', async () => {
    const text = `const load = (dispatch) => {
  dispatch({ type: 'LOAD' });
};
const save = (dispatch, api) => {
  dispatch(load);
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
};
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // save's dispatch is called with incompatible shapes (a function and a
    // plain action), so no inferred type can satisfy its body; api keeps its
    // type.
    expect(result).toBe(`const load = (dispatch: (arg0: { type: string; }) => void) => {
  dispatch({ type: 'LOAD' });
};
const save = (dispatch, api: (arg0: { method: string; url: string; }) => void) => {
  dispatch(load);
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
};
`);
  });

  it('leaves the parameters of a returned arrow function alone', async () => {
    const text = `const load = () => (dispatch, getState, api) => {
  const state = getState();
  dispatch({ type: 'LOAD' });
  return api({ method: 'GET', url: state.url });
};
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // The outer return type is what types these; inferring them from this one
    // body would narrow dispatch to the single action it happens to send.
    expect(result).toBeUndefined();
  });

  it('leaves the parameters of a function returned by a return statement alone', async () => {
    const text = `function load() {
  return function (dispatch) {
    dispatch({ type: 'LOAD' });
  };
}
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBeUndefined();
  });

  it('annotates inside a returned function while leaving its parameters alone', async () => {
    const text = `const load = () => (dispatch) => {
  function fmt(n) {
    return n.toFixed(2);
  }
  dispatch({ type: 'LOAD', total: fmt(1) });
};
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // fmt is called where it is declared, so its own call sites are the
    // evidence for it; only the returned function's parameters are refused.
    expect(result).toBe(`const load = () => (dispatch) => {
  function fmt(n: number) {
    return n.toFixed(2);
  }
  dispatch({ type: 'LOAD', total: fmt(1) });
};
`);
  });

  it('still annotates a function that is not returned from another one', async () => {
    const text = `const send = (dispatch) => {
  dispatch({ type: 'LOAD' });
};
const load = () => (dispatch) => {
  dispatch({ type: 'LOAD' });
};
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`const send = (dispatch: (arg0: { type: string; }) => void) => {
  dispatch({ type: 'LOAD' });
};
const load = () => (dispatch) => {
  dispatch({ type: 'LOAD' });
};
`);
  });

  it('keeps annotations when the only conflict is an improper caller elsewhere', async () => {
    const text = `function wrap(cb) {
  return cb(1);
}
declare function register(f: (s: string) => void): void;
register(wrap);
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // The mismatched register(wrap) call becomes a type error for ts-ignore
    // to flag; wrap's body-derived annotation stays.
    expect(result).toBe(`function wrap(cb: (arg0: number) => any) {
  return cb(1);
}
declare function register(f: (s: string) => void): void;
register(wrap);
`);
  });

  it('keeps annotations when the conflict is a consumer that never calls them', async () => {
    // The improper user of a body-derived type does not have to be a call.
    // This one is an assignment at the top level, so the error it produces
    // sits in no annotated function and nothing here attributes it - the same
    // position an import error lands in. Only the imports are refused there;
    // an annotation contradicting a consumer is the output this pass is for.
    const text = `function wrap(cb) {
  return cb(1);
}
const registered: (f: (s: string) => void) => void = wrap;
export default registered;
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function wrap(cb: (arg0: number) => any) {
  return cb(1);
}
const registered: (f: (s: string) => void) => void = wrap;
export default registered;
`);
    expect(typeCheck(result as string)).toEqual([
      expect.stringContaining("TS2322: Type '(cb: (arg0: number) => any) => any'"),
    ]);
  });

  it('retains body-derived types when the only conflict is a nested call as a dispatch argument', async () => {
    // Regression test for calleeDeclarationAt stopping at the wrong call node.
    //
    // `inferFromUsage` annotates `dispatch` with a type derived from the
    // `showErr(dispatch)` call site.  That annotation makes
    // `dispatch(setFlag(true))` a TS2345 error because setFlag's return type
    // doesn't satisfy the narrow dispatch annotation.
    //
    // The TS2345 error position lands on `setFlag(true)` — itself a
    // CallExpression passed as an argument.  The old calleeDeclarationAt
    // walked up to that inner call, resolved `setFlag` (not a Parameter), and
    // fell through to the annotated-ancestor path which dropped ALL annotations
    // in `getItem` — including `id: string`.
    //
    // The fix walks up until the current node is a direct argument of an outer
    // call, resolves `dispatch` as the conflicting Parameter, and drops only
    // the dispatch annotation — leaving `id: string` intact.
    const text = `declare function showErr(dispatch: (msg: string) => void): void;
declare function setFlag(v: boolean): number;

function getItem(id) {
  return (dispatch) => {
    dispatch(setFlag(true));
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`declare function showErr(dispatch: (msg: string) => void): void;
declare function setFlag(v: boolean): number;

function getItem(id: string) {
  return (dispatch) => {
    dispatch(setFlag(true));
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`);
  });

    it('retains body-derived types when a narrow callable annotation is called with too few arguments', async () => {
    // TS2554's span sits on the callee (`dispatch`), not on an argument.
    const text = `declare function showErr(dispatch: (msg: string) => void): void;

function getItem(id) {
  return (dispatch) => {
    dispatch();
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`declare function showErr(dispatch: (msg: string) => void): void;

function getItem(id: string) {
  return (dispatch) => {
    dispatch();
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`);
  });

  it('retains body-derived types when the arity conflict sits inside a callback argument', async () => {
    // The violated call (`dispatch()`) is inside a callback that is itself an
    // argument of `each(...)` — the walk must not skip past it to `each`.
    const text = `declare function showErr(dispatch: (msg: string) => void): void;
declare function each(items: string[], cb: (item: string) => void): void;

function getItem(id) {
  return (dispatch) => {
    each([], function (item) {
      dispatch();
    });
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`declare function showErr(dispatch: (msg: string) => void): void;
declare function each(items: string[], cb: (item: string) => void): void;

function getItem(id: string) {
  return (dispatch) => {
    each([], function (item) {
      dispatch();
    });
    showErr(dispatch);
    return id.toUpperCase();
  };
}
getItem('abc');
`);
  });

  it('leaves un-inferable locations to the explicit-any plugin', async () => {
    const text = `function track(count, mystery) {
  count.toFixed(2);
  return mystery;
}
`;

    const inferred = await inferTypesPlugin.run(await realPluginParams({ text }));
    const result = await explicitAnyPlugin.run(
      await realPluginParams({
        text: typeof inferred === 'string' ? inferred : text,
        options: { anyAlias: '$TSFixMe' },
      }),
    );

    expect(result).toBe(`function track(count: number, mystery: $TSFixMe) {
  count.toFixed(2);
  return mystery;
}
`);
  });

  it('asks one position at a time when the combined fix throws', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
`;
    const params = await realPluginParams({ text });
    const failing: ts.LanguageService = {
      ...params.getLanguageService(),
      getCombinedCodeFix: () => {
        throw new Error('Debug Failure. False expression.\nOccurred while inferring /file.ts');
      },
    };
    const notices: PluginFileNotice[] = [];

    const result = await inferTypesPlugin.run({
      ...params,
      getLanguageService: () => failing,
      reportFileNotice: (notice) => notices.push(notice),
    });

    expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
`);
    expect(notices).toEqual([
      {
        reason: 'Could not write every type it inferred: Debug Failure. False expression.',
        hint: 'The rest were written; explicit-any fills in what is left.',
        recovered: true,
      },
    ]);
  });

  it('keeps the functions the compiler can print, and skips the one it cannot', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
function greet(name) {
  return 'hello ' + name.toUpperCase();
}
`;
    const params = await realPluginParams({ text });
    const service = params.getLanguageService();
    // The parameter the compiler cannot print a type for, whichever diagnostic
    // sends it there.
    const unprintable = text.indexOf('(name)') + 1;
    const failing: ts.LanguageService = {
      ...service,
      getCombinedCodeFix: () => {
        throw new Error('Debug Failure. False expression.');
      },
      getCodeFixesAtPosition: (...args) => {
        if (args[1] === unprintable) throw new Error('Debug Failure. False expression.');
        return service.getCodeFixesAtPosition(...args);
      },
    };

    const result = await inferTypesPlugin.run({ ...params, getLanguageService: () => failing });

    expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
function greet(name) {
  return 'hello ' + name.toUpperCase();
}
`);
  });

  it('reports a language service failure rather than reading as nothing to infer', async () => {
    const text = `function add(a, b) {
  return a + b;
}
add(1, 2);
`;
    const params = await realPluginParams({ text });
    const failing: ts.LanguageService = {
      ...params.getLanguageService(),
      getCombinedCodeFix: () => {
        throw new Error('Debug Failure. False expression.\nOccurred while inferring /file.ts');
      },
      getCodeFixesAtPosition: () => {
        throw new Error('Debug Failure. False expression.');
      },
    };
    const notices: PluginFileNotice[] = [];

    const result = await inferTypesPlugin.run({
      ...params,
      getLanguageService: () => failing,
      reportFileNotice: (notice) => notices.push(notice),
    });

    expect(result).toBeUndefined();
    expect(notices).toEqual([
      {
        reason: 'Debug Failure. False expression.',
        hint: 'The file keeps the annotations it had; explicit-any fills the rest in with any.',
      },
    ]);
  });

  describe('mid-run dependencies', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir('ts-migrate-infer-');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('keeps an annotation the dependency text the run will write agrees with', async () => {
      const project = midRunProject(tmpDir, {
        'dep.ts': {
          onDisk: `export const sink = { write( s: number ) { return s; } };
`,
          inRun: `export const sink = { write( s: string ) { return s; } };
`,
        },
        'main.ts': {
          onDisk: `import { sink } from './dep';

export function forward( value ) {
  sink.write( value );
  return value.toUpperCase();
}
`,
        },
      });

      expect(await inferTypesPlugin.run(project.paramsFor('main.ts')))
        .toBe(`import { sink } from './dep';

export function forward( value: string ) {
  sink.write( value );
  return value.toUpperCase();
}
`);
    });

    it('recomputes an annotation the dependency text the run will write contradicts', async () => {
      const project = midRunProject(tmpDir, {
        'dep.ts': {
          onDisk: `export function send( value: string | number ) { return value; }
`,
          inRun: `export function send( value: string ) { return value; }
`,
        },
        'main.ts': {
          onDisk: `import { send } from './dep';

export function relay( value ) {
  send( value );
}
relay( 1 );
relay( 'a' );
`,
        },
      });

      expect(await inferTypesPlugin.run(project.paramsFor('main.ts')))
        .toBe(`import { send } from './dep';

export function relay( value: string ) {
  send( value );
}
relay( 1 );
relay( 'a' );
`);
    });

    it('reads a dependency rewritten between two files at its new text', async () => {
      const consumer = (name: string) => `import { sink } from './dep';

export function ${name}( value ) {
  sink.write( value );
  return value.toUpperCase();
}
`;
      const project = midRunProject(tmpDir, {
        'dep.ts': { onDisk: `export const sink = { write( s: number ) { return s; } };\n` },
        'first.ts': { onDisk: consumer('first') },
        'second.ts': { onDisk: consumer('second') },
      });

      // The dependency still takes a number, so string contradicts it.
      expect(await inferTypesPlugin.run(project.paramsFor('first.ts'))).toBeUndefined();

      project.rewrite('dep.ts', `export const sink = { write( s: string ) { return s; } };\n`);

      // Serving the earlier parse from the shared document registry would drop
      // this annotation the same way.
      expect(await inferTypesPlugin.run(project.paramsFor('second.ts')))
        .toBe(`import { sink } from './dep';

export function second( value: string ) {
  sink.write( value );
  return value.toUpperCase();
}
`);
    });
  });
});
