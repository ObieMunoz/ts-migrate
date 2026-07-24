import { realPluginParams } from '../test-utils';
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
    const text = `const load = () => (dispatch) => {
  dispatch({ type: 'LOAD' });
};
const save = () => (dispatch, api) => {
  dispatch(load());
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
};
`;

    const result = await inferTypesPlugin.run(await realPluginParams({ text }));

    // save's dispatch is called with incompatible shapes (a thunk and a plain
    // action), so no inferred type can satisfy its body; api keeps its type.
    expect(result).toBe(`const load = () => (dispatch: (arg0: { type: string; }) => void) => {
  dispatch({ type: 'LOAD' });
};
const save = () => (dispatch, api: (arg0: { method: string; url: string; }) => void) => {
  dispatch(load());
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
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

  // Every case above validates candidates on the runner's own program through
  // the scratch overlay. A runner that predates it gets a single-file program
  // per candidate instead, which has to reach the same verdicts: these cover
  // the branches where the two could disagree.
  describe('single-file fallback validation', () => {
    const fallbackParams = (text: string) => realPluginParams({ text, scratchText: false });

    it('annotates from call sites', async () => {
      const result = await inferTypesPlugin.run(
        await fallbackParams(`function add(a, b) {
  return a + b;
}
add(1, 2);
`),
      );

      expect(result).toBe(`function add(a: number, b: number) {
  return a + b;
}
add(1, 2);
`);
    });

    it('recomputes a contested annotation from body evidence alone', async () => {
      const result = await inferTypesPlugin.run(
        await fallbackParams(`function greet(name) {
  return name.toUpperCase();
}
greet('bob');
greet(42);
`),
      );

      expect(result).toBe(`function greet(name: string) {
  return name.toUpperCase();
}
greet('bob');
greet(42);
`);
    });

    it('drops only the parameter whose inferred type its own body contradicts', async () => {
      const result = await inferTypesPlugin.run(
        await fallbackParams(`const load = () => (dispatch) => {
  dispatch({ type: 'LOAD' });
};
const save = () => (dispatch, api) => {
  dispatch(load());
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
};
`),
      );

      expect(result).toBe(`const load = () => (dispatch: (arg0: { type: string; }) => void) => {
  dispatch({ type: 'LOAD' });
};
const save = () => (dispatch, api: (arg0: { method: string; url: string; }) => void) => {
  dispatch(load());
  dispatch({ type: 'SAVE', payload: 1 });
  api({ method: 'GET', url: '/x' });
};
`);
    });

    it('leaves parameters alone when inference falls back to any', async () => {
      const result = await inferTypesPlugin.run(
        await fallbackParams(`function noInfo(mystery) {
  return mystery;
}
`),
      );

      expect(result).toBeUndefined();
    });
  });
});
