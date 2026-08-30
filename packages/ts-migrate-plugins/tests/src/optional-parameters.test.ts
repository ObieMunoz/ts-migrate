import optionalParametersPlugin from '../../src/plugins/optional-parameters';
import { realPluginRunner } from '../test-utils';

const run = realPluginRunner(optionalParametersPlugin, { fileName: 'declares.ts' });

describe('optional-parameters plugin', () => {
  it('marks a parameter a call in another file leaves off', async () => {
    const text = `export function pick(source: any, key: any) {
  return source[key];
}
`;
    const result = await run(text, {
      extraFiles: { 'calls.ts': `import { pick } from './declares';\npick({});\n` },
    });

    expect(result).toBe(`export function pick(source: any, key?: any) {
  return source[key];
}
`);
  });

  it('marks every parameter past the fewest arguments any call passes', async () => {
    const text = `export function three(a: any, b: any, c: any) {
  return [a, b, c];
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { three } from './declares';\nthree(1, 2);\nthree(1);\n`,
      },
    });

    expect(result).toBe(`export function three(a: any, b?: any, c?: any) {
  return [a, b, c];
}
`);
  });

  it('leaves a function every call passes every argument to', async () => {
    const text = `export function pair(a: any, b: any) {
  return [a, b];
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { pair } from './declares';\npair(1, 2);\n`,
      },
    });

    expect(result).toBeUndefined();
  });

  it('marks an arrow function assigned to a variable', async () => {
    const text = `export const render = (props: any) => props;
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { render } from './declares';\nrender();\n`,
      },
    });

    expect(result).toBe(`export const render = (props?: any) => props;
`);
  });

  it('marks a class method', async () => {
    const text = `export class Store {
  put(key: any, value: any) {
    return [key, value];
  }
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { Store } from './declares';\nnew Store().put('a');\n`,
      },
    });

    expect(result).toBe(`export class Store {
  put(key: any, value?: any) {
    return [key, value];
  }
}
`);
  });

  it('leaves a parameter that already has a default', async () => {
    const text = `export function greet(name: any, greeting: any = 'hi') {
  return greeting + name;
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { greet } from './declares';\ngreet();\n`,
      },
    });

    expect(result).toBe(`export function greet(name?: any, greeting: any = 'hi') {
  return greeting + name;
}
`);
  });

  it('leaves a binding pattern, which cannot be optional', async () => {
    const text = `export function unpack(id: any, { a, b }: any) {
  return [id, a, b];
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { unpack } from './declares';\nunpack(1);\n`,
      },
    });

    expect(result).toBeUndefined();
  });

  it('leaves an overloaded function', async () => {
    const text = `export function size(value: string): number;
export function size(value: any[], deep: boolean): number;
export function size(value: any, deep?: any) {
  return deep ? value.length : 0;
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { size } from './declares';\nsize([], true);\nsize('a');\n`,
      },
    });

    expect(result).toBeUndefined();
  });

  it('leaves a parameter whose own body contradicts the widening', async () => {
    const text = `export function shout(word: string) {
  return word.toUpperCase();
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { shout } from './declares';\nshout();\n`,
      },
    });

    expect(result).toBeUndefined();
  });

  it('keeps the parameters whose bodies allow it when a sibling does not', async () => {
    const text = `export function shout(word: string) {
  return word.toUpperCase();
}
export function echo(word: any) {
  return word;
}
`;
    const result = await run(text, {
      extraFiles: {
        'calls.ts': `import { echo, shout } from './declares';\nshout();\necho();\n`,
      },
    });

    expect(result).toBe(`export function shout(word: string) {
  return word.toUpperCase();
}
export function echo(word?: any) {
  return word;
}
`);
  });

  it('leaves a function declared outside the project', async () => {
    const text = `import { parse } from './vendor';

export const parsed = parse();
`;
    const result = await run(text, {
      extraFiles: {
        'vendor.d.ts': `export declare function parse(input: string): unknown;\n`,
      },
    });

    expect(result).toBeUndefined();
  });

  it('marks a parameter from a call in the file that declares it', async () => {
    const text = `function add(a: any, b: any) {
  return a + b;
}

export const one = add(1);
`;
    const result = await run(text);

    expect(result).toBe(`function add(a: any, b?: any) {
  return a + b;
}

export const one = add(1);
`);
  });
});
