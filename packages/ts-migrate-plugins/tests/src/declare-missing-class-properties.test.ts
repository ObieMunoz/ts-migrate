import ts from 'typescript';
import { mockDiagnostic, mockPluginParams, realPluginParams } from '../test-utils';
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
});
