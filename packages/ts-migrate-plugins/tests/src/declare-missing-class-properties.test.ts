import { mockDiagnostic, mockPluginParams } from '../test-utils';
import declareMissingClassPropertiesPlugin from '../../src/plugins/declare-missing-class-properties';

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

  it('returns the original text when parsing throws', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Duplicate parameter names are a strict-mode SyntaxError for the parser.
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
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
