import path from 'path';
import ts from 'typescript';
import { PluginParams } from '@obiemunoz/ts-migrate-server';
import { mockPluginParams, realPluginParams } from '../test-utils';
import retryConversionsPlugin from '../../src/plugins/retry-conversions';

async function run(text: string, compilerOptions?: ts.CompilerOptions): Promise<string | void> {
  return retryConversionsPlugin.run(await realPluginParams({ text, compilerOptions }));
}

const fixturesDir = path.resolve(__dirname, '../fixtures/retry-conversions');
const entryFile = path.join(fixturesDir, 'entry.ts');

const fixtureCompilerOptions: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

/**
 * Params rooted in the fixture directory, so the imports of the file under
 * migration resolve the same way in the warm program and in the validation
 * programs the plugin builds, which read every file but this one from disk.
 */
function fixtureParams(text: string): PluginParams<unknown> {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => fixtureCompilerOptions,
    getScriptFileNames: () => [entryFile],
    getScriptVersion: () => '0',
    getScriptSnapshot: (name) => {
      const contents = name === entryFile ? text : ts.sys.readFile(name);
      return contents !== undefined ? ts.ScriptSnapshot.fromString(contents) : undefined;
    },
    getCurrentDirectory: () => fixturesDir,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => name === entryFile || ts.sys.fileExists(name),
    readFile: (name) => (name === entryFile ? text : ts.sys.readFile(name)),
  };
  const languageService = ts.createLanguageService(host);
  const sourceFile = languageService.getProgram()?.getSourceFile(entryFile);
  if (!sourceFile) throw new Error(`Failed to create source file: ${entryFile}`);

  return {
    options: {},
    fileName: entryFile,
    rootDir: fixturesDir,
    text,
    sourceFile,
    getLanguageService: () => languageService,
  };
}

function runInFixture(text: string): string | void {
  return retryConversionsPlugin.run(fixtureParams(text));
}

describe('retry-conversions plugin', () => {
  it('drops an assertion the checker no longer needs, with its parentheses', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
`;

    expect(await run(text)).toBe(`interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
`);
  });

  it('restores a load-bearing assertion byte for byte', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export function read(fallback: string) {
  switch   (fallback) {
    default:
      return (widget as any).notDeclared;
  }
}
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps a removable assertion and restores the one beside it', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
export const missing = (widget as any).notDeclared;
`;

    expect(await run(text)).toBe(`interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
export const missing = (widget as any).notDeclared;
`);
  });

  it('leaves a user written assertion alone', async () => {
    const text = `declare const value: unknown;

export const text = value as string;
export const length = (value as string).length;
`;

    expect(await run(text)).toBe(text);
  });

  it('drops an assertion to an alias the project declares as any', async () => {
    const text = `type $TSFixMe = any;

interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as $TSFixMe).name;
`;

    expect(await run(text)).toBe(`type $TSFixMe = any;

interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
`);
  });

  it('leaves an assertion to an alias that is not any alone', async () => {
    const text = `type Loose = string;

declare const value: string;

export const upper = (value as Loose).toUpperCase();
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the parentheses around an optional chain', async () => {
    const text = `declare const outer: { inner?: { name: string } };

export const name = (outer.inner?.name as any) ?? '';
`;

    expect(await run(text)).toBe(`declare const outer: { inner?: { name: string } };

export const name = (outer.inner?.name) ?? '';
`);
  });

  it('drops the assertion on an input element the file can read through', async () => {
    const text = `declare const el: HTMLInputElement;

export const value = (el as any).value;
`;

    expect(await run(text)).toBe(`declare const el: HTMLInputElement;

export const value = el.value;
`);
  });

  it('narrows an assertion the file needs to the operand type without its null', async () => {
    const text = `export const cls = (document.getElementById('root') as any).className;
`;

    expect(await run(text)).toBe(`export const cls = (document.getElementById('root') as HTMLElement).className;
`);
  });

  it('narrows to what the position expects once the operand type is rejected', async () => {
    const text = `interface Raw {
  a: number;
}
interface Opts {
  a: number;
  b: number;
}
declare function accept(opts: Opts): number;
declare const raw: Raw;

export const size = accept(raw as any);
`;

    expect(await run(text)).toBe(`interface Raw {
  a: number;
}
interface Opts {
  a: number;
  b: number;
}
declare function accept(opts: Opts): number;
declare const raw: Raw;

export const size = accept(raw as Opts);
`);
  });

  it('leaves an anonymous object type alone', async () => {
    const text = `declare function accept(opts: { a: number }): number;
declare const raw: unknown;

export const size = accept(raw as any);
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves an assertion alone when the type the position expects carries void', async () => {
    const text = `declare function accept(value: string | void): number;
declare const raw: unknown;

export const size = accept(raw as any);
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves an oversized union alone', async () => {
    const text = `declare function accept(key: 'a' | 'b' | 'c' | 'd' | 'e'): number;
declare const raw: unknown;

export const size = accept(raw as any);
`;

    expect(await run(text)).toBe(text);
  });

  it('restores a narrowing that errors byte for byte', async () => {
    const text = `interface Cat {
  meow(): void;
}
interface Dog {
  bark(): void;
}
declare const dog: Dog;

export const cat: Cat = dog   as   any;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves an assertion alone when the printed name is shadowed', async () => {
    const text = `interface Opts {
  a: number;
}
declare function accept(opts: Opts): number;

export function size(raw: unknown) {
  type Opts = any;
  const zero: Opts = 0;
  return accept(raw as any) + zero;
}
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves a type that is not in scope alone', () => {
    expect(
      runInFixture(`import { store } from './types';

declare const raw: unknown;

export const id = store(raw as any);
`),
    ).toBe(`import { store } from './types';

declare const raw: unknown;

export const id = store(raw as any);
`);
  });

  it('narrows to a named type the file already imports', () => {
    expect(
      runInFixture(`import { store, Widget } from './types';

declare const raw: unknown;

export const id = store(raw as any);
`),
    ).toBe(`import { store, Widget } from './types';

declare const raw: unknown;

export const id = store(raw as Widget);
`);
  });

  it('changes nothing on a second run', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
export const missing = (widget as any).notDeclared;
export const cls = (document.getElementById('root') as any).className;
`;

    const once = await run(text);
    expect(typeof once).toBe('string');
    expect(once).toContain('as HTMLElement');
    expect(await run(once as string)).toBe(once);
  });

  it('does not query the language service for a file with no assertion', async () => {
    const params = mockPluginParams({
      text: 'export const answer = 42;\n',
    });
    const result = retryConversionsPlugin.run({
      ...params,
      getLanguageService: () => {
        throw new Error('the language service must not be queried');
      },
    });

    expect(result).toBe('export const answer = 42;\n');
  });
});
