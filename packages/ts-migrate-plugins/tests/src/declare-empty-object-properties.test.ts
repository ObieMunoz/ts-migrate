import ts from 'typescript';
import { mockPluginParams, realPluginParams } from '../test-utils';
import declareEmptyObjectPropertiesPlugin from '../../src/plugins/declare-empty-object-properties';

async function run(text: string, compilerOptions?: ts.CompilerOptions): Promise<string> {
  const result = await declareEmptyObjectPropertiesPlugin.run(
    await realPluginParams({ text, options: { anyAlias: '$TSFixMe' }, compilerOptions }),
  );
  return result ?? text;
}

/** Compiles the given text in memory, resolving the lib files from disk. */
function typeCheck(text: string, compilerOptions?: ts.CompilerOptions): string[] {
  const fileName = '/checked.ts';
  const files: { [name: string]: string } = { [fileName]: text };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...compilerOptions,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => {
      const contents = files[name] ?? ts.sys.readFile(name);
      return contents === undefined
        ? undefined
        : ts.createSourceFile(name, contents, languageVersion, true);
    },
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name in files || ts.sys.fileExists(name),
    readFile: (name) => files[name] ?? ts.sys.readFile(name),
  };
  const program = ts.createProgram([fileName], options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
  );
}

describe('declare-empty-object-properties plugin', () => {
  it('types an accumulator from its property assignments', async () => {
    const text = `const cache = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`;

    const result = await run(text);

    expect(result).toBe(`const cache: { total?: number; label?: string } = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves an accumulator with no reported write alone', async () => {
    const text = `const cache: { total?: number } = {};
cache.total = 1;
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('is idempotent', async () => {
    const text = `const cache = {};
cache.total = 1;
export default cache;
`;

    const once = await run(text);
    expect(await run(once)).toBe(once);
  });

  it('unions the types of repeated assignments to one key', async () => {
    const text = `declare const flag: boolean;
const cache = {};
cache.value = 1;
if (flag) {
  cache.value = 'x';
}
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { value?: number | string } = {};');
    expect(typeCheck(result)).toEqual([]);
  });

  it('declares string-literal keys and quotes the ones that need it', async () => {
    const text = `const cache = {};
cache['total'] = 1;
cache['a-b'] = 'x';
export default cache;
`;

    const result = await run(text);

    expect(result).toContain(`const cache: { total?: number; "a-b"?: string } = {};`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves computed keys for add-conversions', async () => {
    const text = `declare const key: string;
const cache = {};
cache[key] = 1;
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps a computed key writable alongside a declared one', async () => {
    const text = `declare const key: string;
const cache = {};
cache.total = 1;
cache[key] = 2;
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { total?: number } = {};');
  });

  it('takes the alias for a value the checker only types any', async () => {
    const text = `declare const thing: any;
const cache = {};
cache.total = thing;
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { total?: $TSFixMe } = {};');
  });

  it.each([
    ['an empty array', 'cache.items = [];\ncache.items.push(1);'],
    ['an empty object', 'cache.items = {};\ncache.items.nested = 1;'],
    ['null', 'cache.items = null;'],
  ])('takes the alias for %s', async (_name, body) => {
    const text = `const cache = {};
${body}
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { items?: $TSFixMe } = {};');
  });

  it('leaves the file untouched when the annotation would introduce an error', async () => {
    const text = `let cache = {};
cache.total = 1;
cache = { label: 'x' };
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves the file untouched when a value type has no name in scope', async () => {
    const text = `const cache = {};
function make() {
  class Local {
    x = 1;
  }
  return new Local();
}
cache.node = make();
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the declarations that check when another one does not', async () => {
    const text = `let broken = {};
broken.total = 1;
broken = { label: 'x' };
const kept = {};
kept.count = 2;
export { broken, kept };
`;

    const result = await run(text);

    expect(result).toContain('let broken = {};');
    expect(result).toContain('const kept: { count?: number } = {};');
    // The write `broken` kept is the one add-conversions casts, and the only
    // error left: annotating it would have made the reassignment below fail.
    expect(typeCheck(result)).toEqual(["TS2339: Property 'total' does not exist on type '{}'."]);
  });

  it('types an accumulator whose values are objects and functions', async () => {
    const text = `const config = {};
config.options = { retries: 2, label: 'x' };
config.load = () => 1;
export default config;
`;

    const result = await run(text);

    expect(result).toContain(
      'const config: { options?: { retries: number; label: string; }; load?: () => number } = {};',
    );
    expect(typeCheck(result)).toEqual([]);
  });

  it('works without strictNullChecks', async () => {
    const text = `const cache = {};
cache.total = 1;
cache.items = [];
export default cache;
`;

    const result = await run(text, { strict: false, noImplicitAny: false });

    expect(result).toContain('const cache: { total?: number; items?: $TSFixMe } = {};');
  });

  it('does nothing without a program', () => {
    const text = `const cache = {};
cache.total = 1;
`;

    expect(declareEmptyObjectPropertiesPlugin.run(mockPluginParams({ text }))).toBe(text);
  });
});
