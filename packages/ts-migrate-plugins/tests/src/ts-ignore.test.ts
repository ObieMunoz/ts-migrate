import ts from 'typescript';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import tsIgnorePlugin from '../../src/plugins/ts-ignore';
import {
  mockPluginParams,
  mockDiagnostic,
  realPluginParams,
  realPluginRunner,
} from '../test-utils';

const run = realPluginRunner(tsIgnorePlugin);

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

    const result = await run(text, {
      fileName: 'view.tsx',
      compilerOptions: { jsx: ts.JsxEmit.React },
    });

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

// Re-checks plugin output with a fresh language service so assertions run
// against the diagnostics tsc would actually report post-migration.
async function residualDiagnosticCodes(
  fileName: string,
  text: string,
  compilerOptions?: ts.CompilerOptions,
  extraFiles?: { [extraFileName: string]: string },
): Promise<number[]> {
  const params = await realPluginParams({ fileName, text, compilerOptions, extraFiles });
  const languageService = params.getLanguageService();
  return [
    ...languageService.getSyntacticDiagnostics(params.fileName),
    ...languageService.getSemanticDiagnostics(params.fileName),
  ].map((diagnostic) => diagnostic.code);
}

describe('ts-ignore plugin with ambient environment types', () => {
  // Global declarations standing in for an @types package (the harness has
  // no directory enumeration, so the stub is loaded as a root file).
  const strictOptions: ts.CompilerOptions = { strict: true };
  const typesFixture = {
    'node_modules/@types/node/index.d.ts': 'declare var require: (id: string) => any;\n',
  };

  it('suppresses nothing for globals that ambient declarations provide, and the output passes a fresh check', async () => {
    const text = "var lib = require('some-lib');\nconst count: number = 'oops';\n";

    const result = (await run(text, {
      compilerOptions: strictOptions,
      extraFiles: typesFixture,
    })) as string;

    // `require` resolves through the ambient declaration — suppressing it
    // would leave an unused directive for any compiler that loads the types.
    expect(result).not.toMatch(/TS\(2591\)|TS\(2580\)|TS\(2304\)/);
    expect(result).toContain('TS(2322)');
    expect(await residualDiagnosticCodes('file.ts', result, strictOptions, typesFixture)).toEqual(
      [],
    );
  });
});

describe('ts-ignore plugin multiline string/comment contexts', () => {
  it('does not corrupt a backslash-continued string literal', async () => {
    const text = `const id = (a: number) => a;
const banner = 'Hello \\
World'; id(1, 2);
console.log(banner);
`;

    const result = (await run(text)) as string;

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

    const result = (await run(text)) as string;

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

    const result = (await run(text)) as string;

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

    const result = (await run(text, { fileName: 'file.tsx', compilerOptions })) as string;

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

    const result = (await run(text, { fileName: 'file.tsx', compilerOptions })) as string;

    expect(result).toContain(`title="alpha
beta"`);
    expect(result).not.toMatch(/^\s*\/\/ @ts-expect-error.*\n\s*<\//m);
    const residual = await residualDiagnosticCodes('file.tsx', result, compilerOptions);
    expect(residual).not.toContain(7026);
    expect(residual.filter((code) => code >= 1000 && code < 2000)).toEqual([]); // no parse errors
  });

  it('skips a diagnostic no AST node matches inside a multiline template, keeping other suppressions', async () => {
    const text = `const sql = \`SELECT *
  FROM widgets\`;
comsole.log(sql);
`;

    // Reported rather than printed: the same cause repeats across a project,
    // and the runner groups the files it happened to.
    const notices: PluginFileNotice[] = [];
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [
          // Span covers text inside the template token, so no node matches.
          mockDiagnostic(text, 'FROM', { code: 2554 }),
          mockDiagnostic(text, 'comsole'),
        ],
        options: { messagePrefix: 'FIXME' },
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    // The marker goes on the statement around the template: inside it a `//`
    // would be more of the string.
    expect(result).toBe(`// TODO(ts-migrate): The TypeScript compile check will report them; they need a source change.
// could not add @ts-expect-error inside a multiline string, template, or comment, so those
// diagnostics are left unsuppressed
const sql = \`SELECT *
  FROM widgets\`;
// @ts-expect-error TS(123) FIXME: diagnostic message
comsole.log(sql);
`);
    expect(notices).toHaveLength(1);
    expect(notices[0].reason).toContain('could not add @ts-expect-error inside a multiline');
    expect(notices[0].recovered).toBe(true);
    expect(notices[0].marked).toBe(true);
  });

  it('has nowhere to mark a diagnostic that falls in a comment, and says so', async () => {
    const text = `/* a comment
   spanning lines */
const a = 1;
`;

    const notices: PluginFileNotice[] = [];
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        // Inside the comment, which belongs to no node at all.
        semanticDiagnostics: [mockDiagnostic(text, 'spanning', { code: 2554 })],
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    expect(result).toBe(text);
    expect(notices[0].marked).toBe(false);
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

    const result = (await run(text, { compilerOptions })) as string;

    expect(result).toContain('/* webpackChunkName: "lazy-mod" */');
    expect(await residualDiagnosticCodes('file.ts', result, compilerOptions)).not.toContain(2307);
  });
});

// The `object` props placeholder must error at the props access itself (like the
// legacy `{}` did), not type unknown props as `never` the way `Record<string, never>`
// would — otherwise suppressions shift onto every downstream usage and existing
// @ts-expect-error comments become unused directives (TS2578).
describe('ts-ignore plugin with prop-less component placeholder', () => {
  const componentText = `type State = any;

declare class Component<P, S> {
  props: Readonly<P>;
  state: S;
}
`;
  const compilerOptions = { jsx: ts.JsxEmit.React };

  it('suppresses object-placeholder props errors at the access site', async () => {
    const text = `${componentText}
export class ReadMore extends Component<object, State> {
  htmlSEO = () => {
    const { html } = this.props;
    return String(html);
  };

  render() {
    const { text, title } = this.props;
    return title ? String(title) : String(text);
  }
}
`;

    const result = (await run(text, { fileName: 'file.tsx', compilerOptions })) as string;

    const lines = result.split('\n');
    ['const { html } = this.props;', 'const { text, title } = this.props;'].forEach((access) => {
      const index = lines.findIndex((line) => line.includes(access));
      expect(index).toBeGreaterThan(0);
      expect(lines[index - 1]).toMatch(/^\s*\/\/ @ts-expect-error TS\(2339\)/);
    });

    expect(await residualDiagnosticCodes('file.tsx', result, compilerOptions)).toEqual([]);
  });

  it('keeps existing suppressions above props accesses valid', async () => {
    const text = `${componentText}
export class ReadMore extends Component<object, State> {
  render() {
    // @ts-expect-error TS(2339): Property 'html' does not exist on type 'Readonly<{}>'.
    const { html } = this.props;
    return String(html);
  }
}
`;

    expect(await residualDiagnosticCodes('file.tsx', text, compilerOptions)).toEqual([]);
  });
});

// A value imported with `import type` is erased when TypeScript emits, so
// suppressing its use ships a file that compiles and then throws for an
// undefined binding. eslint-fix runs the project's own config, and a rule that
// rewrites value imports as type-only ones is what leaves these behind.
describe('ts-ignore plugin with a value imported as a type', () => {
  const extraFiles = {
    'cn.ts':
      "export function cn(...args: string[]) { return args.join(' '); }\n" +
      'export type Args = string[];\n',
    'nav.ts': 'export function replace(path: string) { return path; }\n',
  };

  it('drops the type modifier instead of suppressing the call', async () => {
    const text = `import type { cn } from './cn';

export const classes = cn('a', 'b');
`;

    const result = (await run(text, { extraFiles })) as string;

    expect(result).toBe(`import { cn } from './cn';

export const classes = cn('a', 'b');
`);
    expect(await residualDiagnosticCodes('file.ts', result, undefined, extraFiles)).toEqual([]);
  });

  it('repairs the import once for every use of it', async () => {
    const text = `import type { replace } from './nav';

export const map = { replace };
export const go = () => replace('/');
`;

    const result = (await run(text, { extraFiles })) as string;

    expect(result).toContain("import { replace } from './nav';");
    expect(result).not.toContain('@ts-expect-error');
    expect(await residualDiagnosticCodes('file.ts', result, undefined, extraFiles)).toEqual([]);
  });

  it('drops the type modifier off a default import', async () => {
    const text = `import type cn from './default-cn';

export const classes = cn('a');
`;
    const files = { 'default-cn.ts': 'export default function cn(a: string) { return a; }\n' };

    const result = (await run(text, { extraFiles: files })) as string;

    expect(result).toContain("import cn from './default-cn';");
    expect(await residualDiagnosticCodes('file.ts', result, undefined, files)).toEqual([]);
  });

  it('drops an inline type modifier and leaves the rest of the import alone', async () => {
    const text = `import { type cn, type Args } from './cn';

export const classes = cn('a');
export const args: Args = ['a'];
`;

    const result = (await run(text, { extraFiles })) as string;

    expect(result).toContain("import { cn, type Args } from './cn';");
    expect(await residualDiagnosticCodes('file.ts', result, undefined, extraFiles)).toEqual([]);
  });

  it('keeps suppressing the other diagnostics in a repaired file', async () => {
    const text = `import type { cn } from './cn';

export const classes = cn('a');
export const count: number = 'oops';
`;

    const result = (await run(text, { extraFiles })) as string;

    expect(result).toContain("import { cn } from './cn';");
    expect(result).toContain('TS(2322)');
    expect(await residualDiagnosticCodes('file.ts', result, undefined, extraFiles)).toEqual([]);
  });

  // The repair is only ever right for a name that has a value to import, and
  // that is exactly the case TypeScript reports as TS1361; a name that is only
  // a type is TS2693, with no fix to offer.
  it('suppresses a name that is only ever a type', async () => {
    const text = `import type { Args } from './cn';

export const args = Args;
`;

    const result = (await run(text, { extraFiles })) as string;

    expect(result).toContain("import type { Args } from './cn';");
    expect(result).toContain('TS(2693)');
  });

  // Nothing reformats after this plugin, so the comment has to arrive indented
  // the way the line it goes above is indented, whichever whitespace that is.
  it('indents the comment with the tabs the line below it uses', async () => {
    const text = [
      'declare const maybe: { a: string } | undefined;',
      'function outer() {',
      '\tfunction inner() {',
      '\t\treturn maybe.a;',
      '\t}',
      '\treturn inner;',
      '}',
      'export default outer;',
      '',
    ].join('\n');

    const result = (await run(text)) as string;

    expect(result).toContain("\t\t// @ts-expect-error TS(18048): 'maybe' is possibly 'undefined'.\n");
  });

  it('reports the use it leaves suppressed when no repair is offered', async () => {
    const text = `import type { cn } from './cn';

export const classes = cn('a');
`;
    const notices: PluginFileNotice[] = [];

    // The mock language service offers no code fixes at all, which is how a
    // compiler that stops offering this one would look from here.
    const result = await tsIgnorePlugin.run(
      mockPluginParams({
        text,
        semanticDiagnostics: [mockDiagnostic(text, "cn('a')", { code: 1361 })],
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    expect(result).toContain("import type { cn } from './cn';");
    expect(result).toContain('@ts-expect-error TS(1361)');
    expect(notices).toHaveLength(1);
    expect(notices[0].recovered).toBe(true);
    expect(notices[0].reason).toMatch(/imported with `import type`/);
  });
});
