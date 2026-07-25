import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import {
  midRunProject,
  mockDiagnostic,
  mockPluginParams,
  realPluginParams,
  typeCheck,
} from '../test-utils';
import declareMissingClassPropertiesPlugin from '../../src/plugins/declare-missing-class-properties';

async function runReal(
  text: string,
  compilerOptions?: ts.CompilerOptions,
): Promise<string | undefined> {
  return declareMissingClassPropertiesPlugin.run(
    await realPluginParams({ text, options: { anyAlias: '$TSFixMe' }, compilerOptions }),
  );
}

describe('declare-missing-class-properties plugin', () => {
  it.each([2339, 2551])(
    'declares missing class properties with diagnostic code %i',
    async (diagnosticCode) => {
      const text = `class Class1 {
  static foo = 123;
  method1() {
    console.log(this.property1a);
  }

  method2() {
    console.log(this.property2a);
  }
}

class Class2 {
  method1() {
    console.log(this.property1b);
  }

  method2() {
    console.log(this.property2b);
  }
}`;

      const diagnosticFor = (str: string) => mockDiagnostic(text, str, { code: diagnosticCode });
      const result = await declareMissingClassPropertiesPlugin.run(
        mockPluginParams({
          options: { anyAlias: '$TSFixMe' },
          text,
          semanticDiagnostics: [
            diagnosticFor('property1a'),
            diagnosticFor('property2a'),
            diagnosticFor('property1b'),
            diagnosticFor('property2b'),
          ],
        }),
      );

      expect(result).toBe(`class Class1 {
  static foo = 123;
  property1a: $TSFixMe;
  property2a: $TSFixMe;
  method1() {
    console.log(this.property1a);
  }

  method2() {
    console.log(this.property2a);
  }
}

class Class2 {
  property1b: $TSFixMe;
  property2b: $TSFixMe;
  method1() {
    console.log(this.property1b);
  }

  method2() {
    console.log(this.property2b);
  }
}`);
    },
  );

  it('does not declare properties for this inside object-literal methods', async () => {
    const text = `class Store {
  init() {
    const handler = {
      count: 0,
      bump() { this.total = (this.total || 0) + 1; return this.total; },
    };
    return handler.bump();
  }
}`;

    const result = await declareMissingClassPropertiesPlugin.run(
      mockPluginParams({
        text,
        // `this` here is the object literal, not the Store instance.
        semanticDiagnostics: [mockDiagnostic(text, 'total', { code: 2339 })],
      }),
    );

    expect(result).toBe(text);
  });

  it('does not declare properties for this inside function expressions', async () => {
    const text = `class Registry {
  install() {
    const plugin = function plugin() {
      this.hooks = [];
    };
    return plugin;
  }
}`;

    const result = await declareMissingClassPropertiesPlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'hooks', { code: 2339 })],
      }),
    );

    expect(result).toBe(text);
  });

  it('declares properties in classes with static blocks', async () => {
    const text = `class Store {
  static registry;

  static {
    Store.registry = new Map();
  }

  init() {
    this.items = [];
  }
}`;

    const result = await declareMissingClassPropertiesPlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'items', { code: 2339 })],
      }),
    );

    expect(result).toBe(`class Store {
  static registry;
  items: any;

  static {
    Store.registry = new Map();
  }

  init() {
    this.items = [];
  }
}`);
  });

  it('ignores diagnostics that do not map to a property access on this', async () => {
    const text = `function f(a, a) {
  return a;
}`;

    const result = await declareMissingClassPropertiesPlugin.run(
      mockPluginParams({
        options: { anyAlias: '$TSFixMe' },
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'return', { code: 2339 })],
      }),
    );

    expect(result).toBe(text);
  });

  describe('inferred property types', () => {
    it('leaves a constructor initialized property for the checker to type', async () => {
      const text = `class Counter {
  constructor() {
    this.count = 0;
  }

  bump() {
    this.count += 1;
  }
}
`;

      expect(await runReal(text)).toBe(`class Counter {
  count;
  constructor() {
    this.count = 0;
  }

  bump() {
    this.count += 1;
  }
}
`);
    });

    it('types a null initialized property with the alias', async () => {
      const text = `class Box {
  constructor() {
    this.value = null;
  }
}
`;

      expect(await runReal(text)).toBe(`class Box {
  value: $TSFixMe;
  constructor() {
    this.value = null;
  }
}
`);
    });

    it('types a property only a method assigns with the alias', async () => {
      const text = `class Store {
  load() {
    this.items = [];
  }
}
`;

      expect(await runReal(text)).toBe(`class Store {
  items: $TSFixMe;
  load() {
    this.items = [];
  }
}
`);
    });

    it('types a property a method reassigns incompatibly with the alias', async () => {
      const text = `class Conflict {
  constructor() {
    this.total = 0;
  }

  reset() {
    this.total = 'none';
  }
}
`;

      expect(await runReal(text)).toBe(`class Conflict {
  total: $TSFixMe;
  constructor() {
    this.total = 0;
  }

  reset() {
    this.total = 'none';
  }
}
`);
    });

    it('types a property a later read contradicts with the alias', async () => {
      const text = `class Options {
  constructor() {
    this.opts = { a: 1 };
  }

  read() {
    return this.opts.b;
  }
}
`;

      expect(await runReal(text)).toBe(`class Options {
  opts: $TSFixMe;
  constructor() {
    this.opts = { a: 1 };
  }

  read() {
    return this.opts.b;
  }
}
`);
    });

    it('types a property assigned from an any with the alias', async () => {
      const text = `declare const raw: any;

class Wrapper {
  constructor() {
    this.value = raw;
  }
}
`;

      expect(await runReal(text)).toBe(`declare const raw: any;

class Wrapper {
  value: $TSFixMe;
  constructor() {
    this.value = raw;
  }
}
`);
    });

    it('types a property assigned from an untyped parameter with the alias', async () => {
      const text = `class Wrapper {
  constructor(input) {
    this.value = input;
  }
}
`;

      expect(await runReal(text)).toBe(`class Wrapper {
  value: $TSFixMe;
  constructor(input) {
    this.value = input;
  }
}
`);
    });

    it('falls back on the properties that fail and keeps the rest', async () => {
      const text = `class Mixed {
  constructor() {
    this.count = 0;
    this.value = null;
  }
}
`;

      expect(await runReal(text)).toBe(`class Mixed {
  count;
  value: $TSFixMe;
  constructor() {
    this.count = 0;
    this.value = null;
  }
}
`);
    });

    it('decides each class in a file on its own', async () => {
      const text = `class Counter {
  constructor() {
    this.count = 0;
  }
}

class Box {
  constructor() {
    this.value = null;
  }
}
`;

      expect(await runReal(text)).toBe(`class Counter {
  count;
  constructor() {
    this.count = 0;
  }
}

class Box {
  value: $TSFixMe;
  constructor() {
    this.value = null;
  }
}
`);
    });

    it('types every property with the alias when noImplicitAny is off', async () => {
      const text = `class Counter {
  constructor() {
    this.count = 0;
  }
}
`;

      expect(await runReal(text, { strict: false })).toBe(`class Counter {
  count: $TSFixMe;
  constructor() {
    this.count = 0;
  }
}
`);
    });

    it('changes nothing on a second run', async () => {
      const text = `class Counter {
  constructor() {
    this.count = 0;
    this.value = null;
  }

  bump() {
    this.count += 1;
  }
}
`;

      const once = await runReal(text);
      expect(once).not.toBe(text);
      expect(await runReal(once as string)).toBe(once);
    });
  });

  describe('empty object literal properties', () => {
    it('types a property the constructor assigns the empty object literal to', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
    this.cache.label = 'x';
  }
}
`;

      const result = await runReal(text);

      expect(result).toBe(`class C {
  cache: { total?: number; label?: string };
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
    this.cache.label = 'x';
  }
}
`);
      expect(typeCheck(result as string)).toEqual([]);
    });

    it('declares string-literal keys and quotes the ones that need it', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache['total'] = 1;
    this.cache['a-b'] = 'x';
  }
}
`;

      const result = await runReal(text);

      expect(result).toContain(`cache: { total?: number; "a-b"?: string };`);
      expect(typeCheck(result as string)).toEqual([]);
    });

    it('takes the alias for a key the checker only types any', async () => {
      const text = `declare const raw: any;

class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = raw;
  }
}
`;

      expect(await runReal(text)).toContain('cache: { total?: $TSFixMe };');
    });

    it.each([
      ['an empty array', 'this.cache.items = [];\n    this.cache.items.push(1);'],
      ['an empty object', 'this.cache.items = {};\n    this.cache.items.nested = 1;'],
      ['null', 'this.cache.items = null;'],
    ])('takes the alias for a key assigned %s', async (_name, body) => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    ${body}
  }
}
`;

      expect(await runReal(text)).toContain('cache: { items?: $TSFixMe };');
    });

    it('types the property without noImplicitAny', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
  }
}
`;

      expect(await runReal(text, { strict: false, noImplicitAny: false })).toContain(
        'cache: { total?: number };',
      );
    });

    it('types the empty object property alongside an inferred one', async () => {
      const text = `class C {
  constructor() {
    this.count = 0;
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
  }
}
`;

      const result = await runReal(text);

      expect(result).toBe(`class C {
  cache: { total?: number };
  count;
  constructor() {
    this.count = 0;
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
  }
}
`);
      expect(typeCheck(result as string)).toEqual([]);
    });

    it('leaves a property with no reported write on it to the checker', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }
}
`;

      expect(await runReal(text)).toBe(`class C {
  cache;
  constructor() {
    this.cache = {};
  }
}
`);
    });

    it('types a property the constructor assigns anything else with the alias', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  reset() {
    this.cache = { label: 'x' };
    this.cache.total = 1;
  }
}
`;

      expect(await runReal(text)).toContain('cache: $TSFixMe;');
    });

    it('types a property only a method assigns the literal to with the alias', async () => {
      const text = `class C {
  load() {
    this.cache = {};
    this.cache.total = 1;
  }
}
`;

      expect(await runReal(text)).toContain('cache: $TSFixMe;');
    });

    it('takes the alias when the property list would introduce an error', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
  }

  read() {
    return this.cache.missing;
  }
}
`;

      expect(await runReal(text)).toContain('cache: $TSFixMe;');
    });

    it('changes nothing on a second run', async () => {
      const text = `class C {
  constructor() {
    this.cache = {};
  }

  load() {
    this.cache.total = 1;
  }
}
`;

      const once = await runReal(text);
      expect(once).not.toBe(text);
      expect(await runReal(once as string)).toBe(once);
    });
  });

  describe('mid-run dependencies', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-declare-')));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('keeps a declaration the dependency text the run will write supports', async () => {
      const project = midRunProject(tmpDir, {
        'dep.ts': {
          onDisk: `export const initial = 0;\n`,
          inRun: `export const initial = '';\n`,
        },
        'main.ts': {
          onDisk: `import { initial } from './dep';

export class Label {
  constructor() {
    this.value = initial;
  }

  shout() {
    return this.value.toUpperCase();
  }
}
`,
        },
      });

      expect(
        await declareMissingClassPropertiesPlugin.run(
          project.paramsFor('main.ts', { anyAlias: '$TSFixMe' }),
        ),
      ).toBe(`import { initial } from './dep';

export class Label {
  value;
  constructor() {
    this.value = initial;
  }

  shout() {
    return this.value.toUpperCase();
  }
}
`);
    });

    it('rejects a declaration the dependency text the run will write contradicts', async () => {
      const project = midRunProject(tmpDir, {
        'dep.ts': {
          onDisk: `export const initial = '';\n`,
          inRun: `export const initial = 0;\n`,
        },
        'main.ts': {
          onDisk: `import { initial } from './dep';

export class Label {
  constructor() {
    this.value = initial;
  }

  shout() {
    return this.value.toUpperCase();
  }
}
`,
        },
      });

      expect(
        await declareMissingClassPropertiesPlugin.run(
          project.paramsFor('main.ts', { anyAlias: '$TSFixMe' }),
        ),
      ).toBe(`import { initial } from './dep';

export class Label {
  value: $TSFixMe;
  constructor() {
    this.value = initial;
  }

  shout() {
    return this.value.toUpperCase();
  }
}
`);
    });
  });
});
