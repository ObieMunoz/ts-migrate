import path from 'path';
import ts from 'typescript';
import { PluginParams } from '@obiemunoz/ts-migrate-server';
import { mockPluginParams } from '../test-utils';
import widenAnnotationsPlugin, { Options } from '../../src/plugins/widen-annotations';

const fixturesDir = path.resolve(__dirname, '../fixtures/widen-annotations');
const entryFile = path.join(fixturesDir, 'entry.ts');

const compilerOptions: ts.CompilerOptions = {
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
function pluginParams(text: string, options: Options = {}): PluginParams<Options> {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
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
    options,
    fileName: entryFile,
    rootDir: fixturesDir,
    text,
    sourceFile,
    getLanguageService: () => languageService,
  };
}

function run(text: string, options?: Options): string | undefined {
  const result = widenAnnotationsPlugin.run(pluginParams(text, options));
  return result as string | undefined;
}

/** Compiles the widened file against the fixture directory. */
function typeCheck(text: string): string[] {
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const contents = fileName === entryFile ? text : ts.sys.readFile(fileName);
      return contents === undefined
        ? undefined
        : ts.createSourceFile(fileName, contents, languageVersion, true);
    },
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    writeFile: () => {},
    getCurrentDirectory: () => fixturesDir,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName === entryFile || ts.sys.fileExists(fileName),
    readFile: (fileName) => (fileName === entryFile ? text : ts.sys.readFile(fileName)),
  };
  const program = ts.createProgram([entryFile], compilerOptions, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
  );
}

/** The widened text, asserted to compile with no diagnostics at all. */
function widen(text: string, options?: Options): string {
  const result = run(text, options);
  if (result === undefined) throw new Error('Expected the plugin to widen something');
  expect(typeCheck(result)).toEqual([]);
  return result;
}

describe('widen-annotations plugin', () => {
  it('widens a variable annotation its initializer contradicts', () => {
    expect(widen('let a: number = null;\n')).toBe('let a: number | null = null;\n');
  });

  it('widens a variable annotation a later assignment contradicts', () => {
    expect(
      widen(`let a: number = 1;
a = undefined;
`),
    ).toBe(`let a: number | undefined = 1;
a = undefined;
`);
  });

  it('widens a class property a method contradicts', () => {
    expect(
      widen(`export class Store {
  value: string = 'a';

  clear() {
    this.value = null;
  }
}
`),
    ).toBe(`export class Store {
  value: string | null = 'a';

  clear() {
    this.value = null;
  }
}
`);
  });

  it('widens an interface member an object literal contradicts', () => {
    expect(
      widen(`interface Config {
  retries: number;
}

export const config: Config = { retries: undefined };
`),
    ).toBe(`interface Config {
  retries: number | undefined;
}

export const config: Config = { retries: undefined };
`);
  });

  it('widens a return annotation the body contradicts', () => {
    expect(
      widen(`export function findId(): string {
  return null;
}
`),
    ).toBe(`export function findId(): string | null {
  return null;
}
`);
  });

  it('unions the base type of a contradicting literal, not the literal', () => {
    expect(widen("let a: number = 'x';\n")).toBe("let a: number | string = 'x';\n");
  });

  it('collects every assignment that blames one annotation', () => {
    expect(
      widen(`let a: number = 1;
a = null;
a = 'x';
`),
    ).toBe(`let a: number | null | string = 1;
a = null;
a = 'x';
`);
  });

  it('parenthesizes a function type before unioning it', () => {
    expect(widen('let a: () => void = null;\n')).toBe('let a: (() => void) | null = null;\n');
  });

  it('leaves parameter annotations alone when the body reassigns them', () => {
    expect(
      run(`export function scale(factor: number) {
  factor = null;
  return factor;
}
`),
    ).toBeUndefined();
  });

  it('leaves parameter annotations alone when a call disagrees', () => {
    expect(
      run(`function scale(factor: number) {
  return factor * 2;
}

export const scaled = scale('2');
`),
    ).toBeUndefined();
  });

  it('leaves a constructor parameter property alone', () => {
    expect(
      run(`export class Store {
  constructor(private value: number) {}

  clear() {
    this.value = null;
  }
}
`),
    ).toBeUndefined();
  });

  it('leaves a union wider than the cap for ts-ignore', () => {
    const text = `let a: string = 1;
a = true;
a = 2n;
a = Symbol('s');
`;
    expect(run(text)).toBeUndefined();
    expect(widen(text, { maxUnionMembers: 5 })).toBe(`let a: string | number | boolean | bigint | symbol = 1;
a = true;
a = 2n;
a = Symbol('s');
`);
  });

  it('leaves an anonymous object type alone', () => {
    expect(run('let a: number = { id: 1 };\n')).toBeUndefined();
  });

  it('leaves a generic that would need type arguments alone', () => {
    expect(run('let a: number = new Map<string, number>();\n')).toBeUndefined();
  });

  it('leaves an annotation a call with no return contradicts', () => {
    const text = `class Module {
  identifier() {
    throw new Error('not implemented');
  }
}

export let id: string = new Module().identifier();
`;
    expect(run(text)).toBeUndefined();
    // What is left is the error ts-ignore suppresses.
    expect(typeCheck(text)).toEqual(["TS2322: Type 'void' is not assignable to type 'string'."]);
  });

  it('widens to undefined where the contradicting call returns it', () => {
    expect(
      widen(`function find() {
  return undefined;
}

export let id: string = find();
`),
    ).toBe(`function find() {
  return undefined;
}

export let id: string | undefined = find();
`);
  });

  it('leaves a type that is not in scope alone', () => {
    expect(
      run(`import { makeWidget } from './types';

export let a: number = makeWidget();
`),
    ).toBeUndefined();
  });

  it('widens to a named type the file already imports', () => {
    expect(
      widen(`import { Widget, makeWidget } from './types';

export let a: number = makeWidget();
`),
    ).toBe(`import { Widget, makeWidget } from './types';

export let a: number | Widget = makeWidget();
`);
  });

  it('discards a widening that breaks a later use', () => {
    expect(
      run(`let count: number = null;

export const doubled = count * 2;
`),
    ).toBeUndefined();
  });

  it('keeps the widenings that prove out and drops the ones that do not', () => {
    const result = run(`let a: number = null;
let b: number = null;

export const doubled = b * 2;
export const kept = a;
`);
    expect(result).toBe(`let a: number | null = null;
let b: number = null;

export const doubled = b * 2;
export const kept = a;
`);
    // What is left is the one error ts-ignore still has to suppress.
    expect(typeCheck(result as string)).toEqual([
      "TS2322: Type 'null' is not assignable to type 'number'.",
    ]);
  });

  it('changes nothing on a second run', () => {
    const once = widen('let a: number = null;\n');
    expect(run(once)).toBeUndefined();
  });

  it('does nothing without a program', () => {
    expect(
      widenAnnotationsPlugin.run(
        mockPluginParams<Options>({ text: 'let a: number = null;\n', options: {} }),
      ),
    ).toBeUndefined();
  });

  it('rejects options it does not accept', () => {
    expect(() => widenAnnotationsPlugin.validate?.({ maxUnionMembers: 'many' })).toThrow();
    expect(widenAnnotationsPlugin.validate?.({ maxUnionMembers: 6 })).toBe(true);
  });
});
