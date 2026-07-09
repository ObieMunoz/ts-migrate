import ts from 'typescript';
import tsIgnorePlugin from '../../src/plugins/ts-ignore';
import { mockPluginParams, mockDiagnostic, realPluginParams } from '../test-utils';

describe('ts-ignore plugin', () => {
  it('adds ignore comment', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'comsole')],
        options: { messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-expect-error TS(123) FIXME: diagnostic message
      comsole.log('Hello');"
    `);
  });

  it('custom comment', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'comsole')],
        options: {
          messagePrefix: 'custom message prefix',
        },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-expect-error TS(123) custom message prefix: diagnostic message
      comsole.log('Hello');"
    `);
  });

  it('adds ignore comment with ts-ignore', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'comsole')],
        options: { useTsIgnore: true, messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-ignore TS(123) FIXME: diagnostic message
      comsole.log('Hello');"
    `);
  });

  it('adds ignore comment in jsx', async () => {
    const text = `import React from 'react';

function Foo() {
  return (
    <div>
      <DoesNotExist />
    </div>
  );
}

export default Foo;
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'DoesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "import React from 'react';

      function Foo() {
        return (
          <div>
            {/* @ts-expect-error TS(123) FIXME: diagnostic message */}
            <DoesNotExist />
          </div>
        );
      }

      export default Foo;
      "
    `);
  });
  it('adds ignore comment in jsx with Fragment', async () => {
    const text = `import React from 'react';

function Foo() {
  return (
    <>
      <DoesNotExist />
    </>
  );
}

export default Foo;
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'DoesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "import React from 'react';

      function Foo() {
        return (
          <>
            {/* @ts-expect-error TS(123) FIXME: diagnostic message */}
            <DoesNotExist />
          </>
        );
      }

      export default Foo;
      "
    `);
  });

  it('truncates error message if too long', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [
          mockDiagnostic(text, 'comsole', {
            messageText: 'This message is too long to print and should be truncated',
          }),
        ],
        options: { messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-expect-error TS(123) FIXME: This message is too long to print and should be tr... Remove this comment to see the full error message
      comsole.log('Hello');"
    `);
  });

  it('use message limit option to avoid error message truncation', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [
          mockDiagnostic(text, 'comsole', {
            messageText:
              'This message is long, but should not be translated because of the messageLimit option value',
          }),
        ],
        options: { messageLimit: 100, messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-expect-error TS(123) FIXME: This message is long, but should not be translated because of the messageLimit option value
      comsole.log('Hello');"
    `);
  });

  it('use message limit option to truncate a error message', async () => {
    const text = "comsole.log('Hello');";
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [
          mockDiagnostic(text, 'comsole', {
            messageText:
              'This message is too long, and should be truncated because of the messageLimit option value',
          }),
        ],
        options: { messageLimit: 75, messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
      "// @ts-expect-error TS(123) FIXME: This message is too long, and should be truncated because of the messageLim... Remove this comment to see the full error message
      comsole.log('Hello');"
    `);
  });

  it('adds ignore comment below webpackChunkName magic comments without disturbing them', async () => {
    const text = `const getComponent = normalizeLoader(() =>
  import(
    /* webpackChunkName: "Component_async" */
    './this_module_does_not_exist'
  ),
);
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'this_module_does_not_exist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toBe(`const getComponent = normalizeLoader(() =>
  import(
    /* webpackChunkName: "Component_async" */
    // @ts-expect-error TS(123) FIXME: diagnostic message
    './this_module_does_not_exist'
  ),
);
`);
  });

  it('handles error within ternary when true', async () => {
    const text = `function foo() {
  return something
    ? doesNotExist
    : other;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'doesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function foo() {
        return something
          ? // @ts-expect-error TS(123) FIXME: diagnostic message
            doesNotExist
          : other;
      }
      "
    `);
  });

  it('handles error within ternary when false', async () => {
    const text = `function foo() {
  return something
    ? other
    : doesNotExist;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'doesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function foo() {
        return something
          ? other
          : // @ts-expect-error TS(123) FIXME: diagnostic message
            doesNotExist;
      }
      "
    `);
  });

  it('handles error within ternary jsx expression', async () => {
    const text = `function Foo() {
  return someBoolean
    ? <ComponentA />
    : <ComponentB />;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'ComponentA')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function Foo() {
        return someBoolean
          ? // @ts-expect-error TS(123) FIXME: diagnostic message
            <ComponentA />
          : <ComponentB />;
      }
      "
    `);
  });

  it('handles error within ternary property access', async () => {
    const text = `function Foo() {
  return someBoolean
    ? this.props.doesNotExist
    : <SomeComponent />;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'doesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function Foo() {
        return someBoolean
          ? // @ts-expect-error TS(123) FIXME: diagnostic message
            this.props.doesNotExist
          : <SomeComponent />;
      }
      "
    `);
  });

  it('handles neighboring eslint disable comment', async () => {
    const text = `function foo() {
  // eslint-disable-next-line
  return doesNotExist;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'doesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function foo() {
        // @ts-expect-error TS(123) FIXME: diagnostic message
        // eslint-disable-next-line
        return doesNotExist;
      }
      "
    `);
  });

  it('handles multiline ternary', async () => {
    const text = `function Foo() {
  return someBoolean ? (
    <ComponentA
      doesNotExist="fail"
    />
  ) : (
    <ComponentB />
  );
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'doesNotExist')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function Foo() {
        return someBoolean ? (
          <ComponentA
            // @ts-expect-error TS(123) FIXME: diagnostic message
            doesNotExist="fail"
          />
        ) : (
          <ComponentB />
        );
      }
      "
    `);
  });

  it('handles single line ternary', async () => {
    const text = `function Foo() {
  return someBoolean ? <ComponentA /> : <ComponentB />;
}
`;

    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, 'ComponentA')],
        options: { messagePrefix: 'FIXME' },
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "function Foo() {
        // @ts-expect-error TS(123) FIXME: diagnostic message
        return someBoolean ? <ComponentA /> : <ComponentB />;
      }
      "
    `);
  });

  it('add comment to closing tag in tsx file', async () => {
    const text = `<div>
  <span>text</span>
</div>
`;
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        fileName: 'Foo.tsx',
        text,
        semanticDiagnostics: [mockDiagnostic(text, '/div')],
        options: { messagePrefix: 'FIXME' },
      }),
    );
    expect(result).toMatchInlineSnapshot(`
"<div>
  <span>text</span>
{/* @ts-expect-error TS(123) FIXME: diagnostic message */}
</div>
"
`);
  });

  // A bare comment line inside JSX children is a text node, not a comment.
  it('brace-wraps ignore comments for real diagnostics inside JSX children', async () => {
    const text = `export const view = (
  <div>
    <DoesNotExist />
  </div>
);
`;

    const result = await tsIgnorePlugin.run(
      await realPluginParams({
        fileName: 'view.tsx',
        text,
        compilerOptions: { jsx: ts.JsxEmit.React },
      }),
    );

    const lines = (result as string).split('\n');
    const targetIndex = lines.findIndex((line) => line.includes('<DoesNotExist />'));
    expect(targetIndex).toBeGreaterThan(0);
    expect(lines[targetIndex - 1]).toMatch(/^\s*\{\/\* @ts-expect-error TS\(\d+\)/);

    const childrenLines = lines.slice(
      lines.findIndex((line) => line.includes('<div>')) + 1,
      lines.findIndex((line) => line.includes('</div>')),
    );
    childrenLines.forEach((line) => {
      expect(line).not.toMatch(/^\s*\/\/ @ts-expect-error/);
    });
  });
});

describe('ts-ignore plugin multiline string/comment contexts', () => {
  // Re-checks plugin output with a fresh language service so assertions run
  // against the diagnostics tsc would actually report post-migration.
  async function residualDiagnosticCodes(
    fileName: string,
    text: string,
    compilerOptions?: ts.CompilerOptions,
  ): Promise<number[]> {
    const params = await realPluginParams({ fileName, text, compilerOptions });
    const languageService = params.getLanguageService();
    return [
      ...languageService.getSyntacticDiagnostics(params.fileName),
      ...languageService.getSemanticDiagnostics(params.fileName),
    ].map((diagnostic) => diagnostic.code);
  }

  it('does not corrupt a backslash-continued string literal', async () => {
    const text = `const id = (a: number) => a;
const banner = 'Hello \\
World'; id(1, 2);
console.log(banner);
`;

    const result = (await tsIgnorePlugin.run(await realPluginParams({ text }))) as string;

    expect(result).toContain(`'Hello \\
World'`);
    const residual = await residualDiagnosticCodes('file.ts', result);
    expect(residual).not.toContain(1002); // Unterminated string literal
    expect(residual).not.toContain(2554);
  });

  it('does not insert into a multiline no-substitution template literal', async () => {
    const text = `const id = (a: number) => a;
const sql = \`SELECT *
  FROM widgets\`; id(1, 2);
console.log(sql);
`;

    const result = (await tsIgnorePlugin.run(await realPluginParams({ text }))) as string;

    expect(result).toContain(`\`SELECT *
  FROM widgets\``);
    expect(await residualDiagnosticCodes('file.ts', result)).not.toContain(2554);
  });

  it('does not insert into a multiline block comment', async () => {
    const text = `const id = (a: number) => a;
const x = 1; /* note that
   continues */ id(1, 2);
console.log(x);
`;

    const result = (await tsIgnorePlugin.run(await realPluginParams({ text }))) as string;

    expect(result).toContain(`/* note that
   continues */`);
    expect(await residualDiagnosticCodes('file.ts', result)).not.toContain(2554);
  });

  it('does not insert into a multiline JSX attribute string', async () => {
    const text = `const fire = (a: number) => a;
function Note() {
  return (
    <div title="alpha
beta" data-x={fire(1, 2)}>hello</div>
  );
}
`;
    const compilerOptions = { jsx: ts.JsxEmit.React };

    const result = (await tsIgnorePlugin.run(
      await realPluginParams({ fileName: 'file.tsx', text, compilerOptions }),
    )) as string;

    expect(result).toContain(`title="alpha
beta"`);
    const residual = await residualDiagnosticCodes('file.tsx', result, compilerOptions);
    expect(residual).not.toContain(2554);
    expect(residual).not.toContain(7026);
    expect(residual.filter((code) => code >= 1000 && code < 2000)).toEqual([]); // no parse errors
    // A bare `//` line between JSX children is rendered text, not a comment.
    expect(result).not.toMatch(/^\s*\/\/ @ts-expect-error.*\n\s*<\//m);
  });

  it('brace-wraps fallback inserts that land in JSX children', async () => {
    // The closing tag's error line starts inside the attribute string, and the
    // insertion point (after 'hello') is in JSX children, where a bare `//`
    // line would become rendered text.
    const text = `function Note() {
  return (
    <div title="alpha
beta" data-x={1}>hello</div>
  );
}
`;
    const compilerOptions = { jsx: ts.JsxEmit.React };

    const result = (await tsIgnorePlugin.run(
      await realPluginParams({ fileName: 'file.tsx', text, compilerOptions }),
    )) as string;

    expect(result).toContain(`title="alpha
beta"`);
    expect(result).not.toMatch(/^\s*\/\/ @ts-expect-error.*\n\s*<\//m);
    const residual = await residualDiagnosticCodes('file.tsx', result, compilerOptions);
    expect(residual).not.toContain(7026);
    expect(residual.filter((code) => code >= 1000 && code < 2000)).toEqual([]); // no parse errors
  });

  it('suppresses module errors on imports with webpackChunkName magic comments', async () => {
    const text = `export const load = () =>
  import(
    /* webpackChunkName: "lazy-mod" */
    './does-not-exist'
  );
`;
    const compilerOptions = {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    };

    const result = (await tsIgnorePlugin.run(
      await realPluginParams({ text, compilerOptions }),
    )) as string;

    expect(result).toContain('/* webpackChunkName: "lazy-mod" */');
    expect(await residualDiagnosticCodes('file.ts', result, compilerOptions)).not.toContain(2307);
  });
});
