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
});
