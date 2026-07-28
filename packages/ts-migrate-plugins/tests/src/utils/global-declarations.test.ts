import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { createTmpDir } from '@obiemunoz/ts-migrate-test-utils';
import {
  buildGlobalDeclarations,
  collectGlobalAssignments,
  createGlobalAssignmentEvidence,
  createGlobalDeclarations,
  formatGlobalDeclarationsReport,
  GlobalAssignmentEvidence,
  GlobalDeclaration,
  GLOBAL_DECLARATIONS_FILE,
  parseGlobalDeclarations,
  renderGlobalDeclarations,
} from '../../../src/utils/globalDeclarations';
import { mockPluginParams } from '../../test-utils';

const fixtureDirs: string[] = [];

function makeFixture(files: { [filePath: string]: string } = {}): string {
  const dir = createTmpDir('global-declarations-');
  fixtureDirs.push(dir);
  Object.entries(files).forEach(([filePath, contents]) => {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  });
  return dir;
}

afterAll(() => {
  fixtureDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

/** Compiles the given files in memory, resolving the lib files from disk. */
function programFor(files: { [fileName: string]: string }): ts.Program {
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = files[fileName] ?? ts.sys.readFile(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName in files || ts.sys.fileExists(fileName),
    readFile: (fileName) => files[fileName] ?? ts.sys.readFile(fileName),
  };
  return ts.createProgram(Object.keys(files), COMPILER_OPTIONS, host);
}

function diagnosticsOf(files: { [fileName: string]: string }): string[] {
  const program = programFor(files);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `${diagnostic.file?.fileName} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        ' ',
      )}`,
  );
}

/** Collects from every file of a real program, the way the pipeline does. */
function collectFrom(files: { [fileName: string]: string }): GlobalAssignmentEvidence {
  const evidence = createGlobalAssignmentEvidence();
  const program = programFor(files);
  const checker = program.getTypeChecker();
  Object.keys(files).forEach((fileName) => {
    const sourceFile = program.getSourceFile(fileName)!;
    collectGlobalAssignments({ evidence, sourceFile, checker });
  });
  return evidence;
}

/** Collects with no program, as the unit tests of a single file do. */
function collectText(text: string, fileName = '/a.ts'): GlobalAssignmentEvidence {
  const evidence = createGlobalAssignmentEvidence();
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  collectGlobalAssignments({ evidence, sourceFile });
  return evidence;
}

function declarationsIn(evidence: GlobalAssignmentEvidence, rootDir: string): GlobalDeclaration[] {
  const result = buildGlobalDeclarations(evidence, rootDir);
  return result.kind === 'declarations' ? result.declarations : [];
}

describe('collectGlobalAssignments', () => {
  it('collects window, global and globalThis assignments at any depth', () => {
    const evidence = collectText(`
if (!window.polyfilled) {
  window.polyfilled = true;
}
function install() {
  global.fetchMock = createMock();
}
globalThis.buildId = '42';
`);

    expect([...evidence.properties.keys()].sort()).toEqual(['buildId', 'fetchMock', 'polyfilled']);
    expect(evidence.properties.get('polyfilled')!.target).toBe('window');
    expect(evidence.properties.get('fetchMock')!.target).toBe('globalThis');
    expect(evidence.properties.get('buildId')!.target).toBe('globalThis');
  });

  it('skips a root an enclosing scope binds', () => {
    const evidence = collectText(`
(function (window) {
  window.fromIife = 1;
})(fakeWindow);
function withLocal() {
  const window = {};
  window.fromLocal = 2;
}
import { globalThis } from './shim';
globalThis.fromImport = 3;
`);

    expect([...evidence.properties.keys()]).toEqual([]);
  });

  it('keeps the assignments outside the scope that binds the root', () => {
    const evidence = collectText(`
window.real = 1;
(function (window) {
  window.fromIife = 2;
})(fakeWindow);
window.alsoReal = 3;
`);

    expect([...evidence.properties.keys()].sort()).toEqual(['alsoReal', 'real']);
  });

  it('skips element access and compound assignment', () => {
    const evidence = collectText(`
window['byString'] = 1;
window[key] = 2;
window.counter += 1;
window.nested.deep = 3;
`);

    expect([...evidence.properties.keys()]).toEqual([]);
  });

  it('unions the types conflicting assignments say, across files', () => {
    const evidence = createGlobalAssignmentEvidence();
    ['window.appName = 1;', "window.appName = 'two';", 'window.appName = 3;'].forEach(
      (text, index) => {
        const sourceFile = ts.createSourceFile(`/f${index}.ts`, text, ts.ScriptTarget.Latest, true);
        collectGlobalAssignments({ evidence, sourceFile });
      },
    );

    const property = evidence.properties.get('appName')!;
    expect([...property.types].sort()).toEqual(['number', 'string']);
    expect(property.files.size).toBe(3);
    expect(property.assignments).toBe(3);
    expect(declarationsIn(evidence, makeFixture())).toEqual([
      { name: 'appName', target: 'window', type: 'number | string' },
    ]);
  });

  it('falls back to any for an expression that does not say what it is', () => {
    const rootDir = makeFixture();
    const evidence = collectText(`
window.config = loadConfig();
window.handler = function () {};
window.store = { items: [] };
window.copy = window.config;
`);

    expect(declarationsIn(evidence, rootDir)).toEqual([
      { name: 'config', target: 'window', type: 'any' },
      { name: 'copy', target: 'window', type: 'any' },
      { name: 'handler', target: 'window', type: 'any' },
      { name: 'store', target: 'window', type: 'any' },
    ]);
  });

  it('falls back to any when a literal type is mixed with an unknown one', () => {
    const rootDir = makeFixture();
    const evidence = collectText("window.mode = 'dark';\nwindow.mode = readMode();");

    expect(declarationsIn(evidence, rootDir)).toEqual([
      { name: 'mode', target: 'window', type: 'any' },
    ]);
  });

  it('falls back to any when every assignment is null or undefined', () => {
    const rootDir = makeFixture();
    const evidence = collectText('window.slot = null;\nwindow.slot = undefined;');

    expect(declarationsIn(evidence, rootDir)).toEqual([
      { name: 'slot', target: 'window', type: 'any' },
    ]);
  });

  it('declares a property assigned through both window and globalThis as a var', () => {
    const evidence = collectText("window.shared = 'a';\nglobalThis.shared = 'b';");

    expect(evidence.properties.get('shared')!.target).toBe('globalThis');
  });

  it('leaves the properties the environment already declares alone', () => {
    const evidence = collectFrom({
      '/a.ts': `
window.location = fakeLocation;
window.name = 'tab';
globalThis.isNaN = check;
window.appConfig = loadConfig();
`,
    });

    expect([...evidence.properties.keys()]).toEqual(['appConfig']);
  });

  it('leaves an environment object that does not resolve alone', () => {
    // No @types/node in the program, so `global` is not a name at all and no
    // declaration added to Window would make this assignment resolve.
    const evidence = collectFrom({ '/a.ts': 'global.fetchMock = createMock();' });

    expect([...evidence.properties.keys()]).toEqual([]);
  });

  it('leaves a global whose name cannot be a var declaration name alone', () => {
    const evidence = collectText(
      'globalThis.import = importShim;\nglobalThis.arguments = argv;\nglobalThis.registry = {};',
    );

    expect([...evidence.properties.keys()]).toEqual(['registry']);
  });

  it('keeps a reserved word assigned through window, where a member is legal', () => {
    const evidence = collectText('window.import = importShim;');

    expect(evidence.properties.get('import')!.target).toBe('window');
  });

  it('does not promote a reserved word to a var when globalThis assigns it too', () => {
    const evidence = collectText('window.import = importShim;\nglobalThis.import = importShim;');

    expect(evidence.properties.get('import')!.target).toBe('window');
  });
});

describe('renderGlobalDeclarations', () => {
  it('writes window members and globals into one declare global block', () => {
    const text = renderGlobalDeclarations([
      { name: 'fetchMock', target: 'globalThis', type: 'any' },
      { name: 'appConfig', target: 'window', type: 'any' },
      { name: 'appName', target: 'window', type: 'number | string' },
    ]);

    expect(text).toMatchInlineSnapshot(`
      "// Generated by ts-migrate. Properties the code assigns to window and globalThis,
      // declared once here so every read and write of them type-checks instead
      // of needing a cast at each site. Narrow a type to the real shape when you
      // know it and ts-migrate keeps your version. Delete an entry once
      // something else declares the property. Do not add entries by hand: the
      // file is rewritten from its own declarations on every run.
      export {};

      declare global {
        interface Window {
          appConfig: any;
          appName: number | string;
        }

        var fetchMock: any;
      }
      "
    `);
  });
});

describe('parseGlobalDeclarations', () => {
  const declarations: GlobalDeclaration[] = [
    { name: 'appConfig', target: 'window', type: 'any' },
    { name: 'appName', target: 'window', type: 'number | string' },
    { name: 'fetchMock', target: 'globalThis', type: 'any' },
  ];

  it('round-trips what renderGlobalDeclarations writes', () => {
    expect(parseGlobalDeclarations(renderGlobalDeclarations(declarations))).toEqual(declarations);
  });

  it('reads a file that has been reformatted', () => {
    const text = `// Generated by ts-migrate. Anything at all on this line.
export {};
declare global {
      interface Window { appConfig: any; appName: number | string }
      var fetchMock: any
}
`;

    expect(parseGlobalDeclarations(text)).toEqual(declarations);
  });

  it('refuses a file ts-migrate did not write', () => {
    expect(parseGlobalDeclarations('declare global {\n  var mine: string;\n}\n')).toBeNull();
  });

  it('refuses a declaration it cannot write back', () => {
    const withInterface = `// Generated by ts-migrate.
export {};
declare global {
  interface Document {
    custom: string;
  }
}
`;
    const withoutType = `// Generated by ts-migrate.
export {};
declare global {
  var untyped;
}
`;
    const withStatementOutside = `// Generated by ts-migrate.
export {};
type Extra = string;
declare global {
  var appName: string;
}
`;

    expect(parseGlobalDeclarations(withInterface)).toBeNull();
    expect(parseGlobalDeclarations(withoutType)).toBeNull();
    expect(parseGlobalDeclarations(withStatementOutside)).toBeNull();
  });

  it('refuses a file that does not parse', () => {
    expect(parseGlobalDeclarations('// Generated by ts-migrate.\ndeclare global {\n')).toBeNull();
  });
});

describe('buildGlobalDeclarations', () => {
  it('writes the declarations to types/ts-migrate-globals.d.ts', () => {
    const rootDir = makeFixture();
    const result = buildGlobalDeclarations(collectText('window.appConfig = load();'), rootDir);

    expect(result.kind).toBe('declarations');
    if (result.kind !== 'declarations') return;
    expect(result.filePath).toBe(path.join(rootDir, 'types', 'ts-migrate-globals.d.ts'));
    expect(GLOBAL_DECLARATIONS_FILE).toBe('types/ts-migrate-globals.d.ts');
  });

  it('declares nothing when nothing was found', () => {
    expect(buildGlobalDeclarations(createGlobalAssignmentEvidence(), makeFixture()).kind).toBe(
      'nothing',
    );
  });

  it('uses the configured any alias', () => {
    const rootDir = makeFixture();
    const result = buildGlobalDeclarations(collectText('window.appConfig = load();'), rootDir, {
      anyAlias: '$TSFixMe',
    });

    expect(result.kind === 'declarations' && result.declarations).toEqual([
      { name: 'appConfig', target: 'window', type: '$TSFixMe' },
    ]);
  });

  it('keeps the entries of an earlier run and a type narrowed by hand', () => {
    const rootDir = makeFixture({
      [GLOBAL_DECLARATIONS_FILE]: renderGlobalDeclarations([
        { name: 'appConfig', target: 'window', type: '{ debug: boolean }' },
        { name: 'gone', target: 'window', type: 'any' },
      ]),
    });

    const result = buildGlobalDeclarations(
      collectText('window.appConfig = load();\nwindow.appName = 1;'),
      rootDir,
    );

    expect(result.kind === 'declarations' && result.declarations).toEqual([
      { name: 'appConfig', target: 'window', type: '{ debug: boolean }' },
      { name: 'appName', target: 'window', type: 'number' },
      { name: 'gone', target: 'window', type: 'any' },
    ]);
  });

  it('replaces a hand narrowed type only when the assignments say what it is', () => {
    const rootDir = makeFixture({
      [GLOBAL_DECLARATIONS_FILE]: renderGlobalDeclarations([
        { name: 'appName', target: 'window', type: '{ debug: boolean }' },
      ]),
    });

    const result = buildGlobalDeclarations(collectText("window.appName = 'app';"), rootDir);

    expect(result.kind === 'declarations' && result.declarations).toEqual([
      { name: 'appName', target: 'window', type: 'string' },
    ]);
  });

  it('upgrades an earlier window member to a var when globalThis assigns it too', () => {
    const rootDir = makeFixture({
      [GLOBAL_DECLARATIONS_FILE]: renderGlobalDeclarations([
        { name: 'shared', target: 'window', type: 'any' },
      ]),
    });

    const result = buildGlobalDeclarations(collectText('globalThis.shared = load();'), rootDir);

    expect(result.kind === 'declarations' && result.declarations).toEqual([
      { name: 'shared', target: 'globalThis', type: 'any' },
    ]);
  });

  it('does not touch a file it did not write', () => {
    const rootDir = makeFixture({
      [GLOBAL_DECLARATIONS_FILE]: 'declare global {\n  interface Window { mine: string }\n}\n',
    });

    const result = buildGlobalDeclarations(collectText('window.appConfig = load();'), rootDir);

    expect(result.kind).toBe('foreign');
  });
});

describe('the generated declarations', () => {
  const sources = {
    '/a.ts': `
interface Config {
  debug: boolean;
}
declare function loadConfig(): Config;

window.appConfig = loadConfig();
window.appName = 'app';
if (!window.polyfilled) {
  window.polyfilled = true;
}
`,
    '/b.ts': `
window.appName = 42;
globalThis.buildId = 'abc';
function useThem() {
  const name: string | number = window.appName;
  const id: string = globalThis.buildId;
  return [name, id, window.appConfig, window.polyfilled];
}
`,
  };

  function generate(rootDir: string): string {
    const result = buildGlobalDeclarations(collectFrom(sources), rootDir);
    if (result.kind !== 'declarations') throw new Error(`Expected declarations, got ${result.kind}`);
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    fs.writeFileSync(result.filePath, result.text);
    return result.text;
  }

  it('type-check with no error at the assignment sites', () => {
    // Without the generated file each site is a TS2339 on window or a TS7017
    // on globalThis, both of which add-conversions turns into an `as any` cast.
    const before = diagnosticsOf(sources);
    expect(before.length).toBeGreaterThan(0);
    expect(
      before.filter((message) => !message.includes('TS2339') && !message.includes('TS7017')),
    ).toEqual([]);

    const text = generate(makeFixture());

    expect(diagnosticsOf({ ...sources, '/types/ts-migrate-globals.d.ts': text })).toEqual([]);
    expect(text).toContain('appName: number | string;');
    expect(text).toContain('var buildId: string;');
    // `Config` is declared in the file the value came from, so a declaration
    // naming it would not resolve here.
    expect(text).toContain('appConfig: any;');
    expect(text).not.toMatch(/:\s*Config\b/);
  });

  it('are unchanged by a second run', () => {
    const rootDir = makeFixture();
    const first = generate(rootDir);

    // A second run over unchanged code, both with the declarations already in
    // the program (the properties resolve, so nothing is found) and without.
    const withFile = buildGlobalDeclarations(
      collectFrom({ ...sources, '/types/ts-migrate-globals.d.ts': first }),
      rootDir,
    );
    const withoutFile = buildGlobalDeclarations(collectFrom(sources), rootDir);

    expect(withFile.kind === 'declarations' && withFile.text).toBe(first);
    expect(withoutFile.kind === 'declarations' && withoutFile.text).toBe(first);
    expect(fs.readFileSync(path.join(rootDir, GLOBAL_DECLARATIONS_FILE), 'utf-8')).toBe(first);
  });

  it('parse when the code assigns globals named after every reserved word', () => {
    // A property access can be named anything, so `globalThis.import = ...`
    // parses; `var import: any;` does not, and one of these in the generated
    // file stops the whole project compiling.
    const reserved = `break case catch class const continue debugger default delete do else enum
export extends false finally for function if import in instanceof new null return super switch
this throw true try typeof var void while with arguments eval`.split(/\s+/);
    const evidence = collectText(
      reserved.map((name) => `globalThis.${name} = 1;\nwindow.${name} = 1;`).join('\n'),
    );
    const result = buildGlobalDeclarations(evidence, makeFixture());
    if (result.kind !== 'declarations') throw new Error(`Expected declarations, got ${result.kind}`);

    const parsed: ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] } =
      ts.createSourceFile('ts-migrate-globals.d.ts', result.text, ts.ScriptTarget.Latest, true);

    expect(parsed.parseDiagnostics ?? []).toEqual([]);
    expect(result.text).not.toMatch(/^\s*var /m);
    expect(parseGlobalDeclarations(result.text)).toEqual(result.declarations);
  });
});

describe('createGlobalDeclarations', () => {
  const runOver = async (
    collector: ReturnType<typeof createGlobalDeclarations>,
    rootDir: string,
    files: { [fileName: string]: string },
  ) => {
    const generated = new Map<string, string>();
    const notices: PluginFileNotice[] = [];
    const params = (fileName: string, text: string) => ({
      ...mockPluginParams({ fileName, text }),
      rootDir,
      addGeneratedFile: (name: string, contents: string) => generated.set(name, contents),
      reportFileNotice: (notice: PluginFileNotice) => notices.push(notice),
    });

    for (const [fileName, text] of Object.entries(files)) {
      await collector.plugin.run(params(fileName, text));
    }
    for (const [fileName, text] of Object.entries(files)) {
      await collector.declarationsPlugin.run(params(fileName, text));
    }
    return { generated, notices };
  };

  it('accumulates across files and writes the file once', async () => {
    const rootDir = makeFixture();
    const collector = createGlobalDeclarations();

    const { generated, notices } = await runOver(collector, rootDir, {
      'a.ts': "window.appName = 'app';",
      'b.ts': 'window.appName = 1;\nglobalThis.buildId = load();',
    });

    const filePath = path.join(rootDir, GLOBAL_DECLARATIONS_FILE);
    expect([...generated.keys()]).toEqual([filePath]);
    expect(generated.get(filePath)).toContain('appName: number | string;');
    expect(generated.get(filePath)).toContain('var buildId: any;');
    expect(notices).toEqual([]);
    expect(collector.summarize()).toEqual({
      filePath,
      declarations: [
        { name: 'appName', target: 'window', type: 'number | string' },
        { name: 'buildId', target: 'globalThis', type: 'any' },
      ],
      properties: [
        { name: 'appName', assignments: 2, fileCount: 2 },
        { name: 'buildId', assignments: 1, fileCount: 1 },
      ],
      foreignFile: undefined,
    });
  });

  it('reports a file it cannot rewrite instead of overwriting it', async () => {
    const rootDir = makeFixture({
      [GLOBAL_DECLARATIONS_FILE]: 'declare global {\n  interface Window { mine: string }\n}\n',
    });
    const collector = createGlobalDeclarations();

    const { generated, notices } = await runOver(collector, rootDir, {
      'a.ts': 'window.appName = load();',
    });

    expect([...generated.keys()]).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0].reason).toContain('declarations ts-migrate did not write');
    expect(collector.summarize().foreignFile).toBe(path.join(rootDir, GLOBAL_DECLARATIONS_FILE));
  });
});

describe('formatGlobalDeclarationsReport', () => {
  it('names each declaration and where its assignments are', () => {
    const report = formatGlobalDeclarationsReport({
      filePath: `/root/${GLOBAL_DECLARATIONS_FILE}`,
      declarations: [
        { name: 'appConfig', target: 'window', type: 'any' },
        { name: 'buildId', target: 'globalThis', type: 'string' },
      ],
      properties: [
        { name: 'appConfig', assignments: 4, fileCount: 2 },
        { name: 'buildId', assignments: 1, fileCount: 1 },
      ],
    });

    expect(report).toContain('2 globals declared in types/ts-migrate-globals.d.ts');
    expect(report).toContain('appConfig: any (4 assignments in 2 files)');
    expect(report).toContain('buildId: string (1 assignment in 1 file)');
    expect(report).toContain('Narrow a type to the real shape');
  });

  it('leaves an entry an earlier run declared without a count', () => {
    const report = formatGlobalDeclarationsReport({
      filePath: `/root/${GLOBAL_DECLARATIONS_FILE}`,
      declarations: [{ name: 'legacy', target: 'window', type: 'any' }],
      properties: [],
    });

    expect(report).toContain('    legacy: any\n');
  });

  it('names the globals a file it cannot rewrite left undeclared', () => {
    const report = formatGlobalDeclarationsReport({
      declarations: [],
      properties: [
        { name: 'buildId', assignments: 1, fileCount: 1 },
        { name: 'appConfig', assignments: 2, fileCount: 1 },
      ],
      foreignFile: `/root/${GLOBAL_DECLARATIONS_FILE}`,
    });

    expect(report).toContain(
      '2 globals went undeclared because types/ts-migrate-globals.d.ts is not a file ' +
        'ts-migrate wrote: appConfig, buildId.',
    );
  });

  it('says nothing when the run declared nothing', () => {
    expect(formatGlobalDeclarationsReport({ declarations: [], properties: [] })).toBeNull();
  });
});
