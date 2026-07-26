import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { Plugin, PluginFileNotice, PluginParams } from '@obiemunoz/ts-migrate-server';

type WithoutFile<T> = Omit<T, 'file'>;

/** A map of file name to contents, for the helpers that build a program. */
export type FileMap = { [fileName: string]: string };

/**
 * Output without the follow-up markers, for asserting what a plugin did to the
 * code itself. A marker is a TODO line plus the comment lines that continue it.
 */
export function withoutMarkers(text: string): string;
export function withoutMarkers(text: string | undefined): string | undefined;
export function withoutMarkers(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let inMarker = false;
  return text
    .split('\n')
    .filter((line) => {
      if (line.trim().startsWith('// TODO(ts-migrate):')) {
        inMarker = true;
        return false;
      }
      if (inMarker && line.trim().startsWith('//')) return false;
      inMarker = false;
      return true;
    })
    .join('\n');
}

export interface MockParams<TOptions = unknown> {
  fileName?: string;
  text?: string;
  semanticDiagnostics?: WithoutFile<ts.Diagnostic>[];
  syntacticDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  suggestionDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  options?: TOptions;
  /** Set to collect what the plugin reports, as the runner does. */
  reportFileNotice?: (notice: PluginFileNotice) => void;
}

export function mockPluginParams<TOptions = unknown>(
  params: MockParams<TOptions>,
): PluginParams<TOptions> {
  const {
    fileName = 'file.ts',
    text = '',
    semanticDiagnostics = [],
    syntacticDiagnostics = [],
    suggestionDiagnostics = [],
    options = {},
    reportFileNotice,
  } = params;

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const withFile = <T>(diagnostic: T): T & { file: ts.SourceFile } => ({
    ...diagnostic,
    file: sourceFile,
  });

  return {
    options: options as unknown as TOptions,
    fileName,
    rootDir: __dirname,
    text,
    sourceFile,
    reportFileNotice,
    getLanguageService: () =>
      ({
        getProgram: () => undefined,
        getSemanticDiagnostics: () => semanticDiagnostics.map(withFile),
        getSyntacticDiagnostics: () => syntacticDiagnostics.map(withFile),
        getSuggestionDiagnostics: () => suggestionDiagnostics.map(withFile),
      } as any),
  };
}

/**
 * A plugin bound to the params a file's tests all pass, so a test reads as the
 * text in and the text out and each `it` states only what it is about. The
 * overrides replace the bound values rather than merging into them, so a test
 * that passes `options: {}` is a test run with no options.
 */
export function pluginRunner<TOptions = unknown>(
  plugin: Plugin<TOptions>,
  defaults: MockParams<TOptions> = {},
) {
  return (text: string, overrides: MockParams<TOptions> = {}) =>
    plugin.run(mockPluginParams<TOptions>({ ...defaults, ...overrides, text }));
}

/**
 * The same, for a test that asserts on what the plugin reported as well as on
 * what it wrote.
 */
export function pluginRunnerWithNotices<TOptions = unknown>(
  plugin: Plugin<TOptions>,
  defaults: MockParams<TOptions> = {},
) {
  return async (text: string, overrides: MockParams<TOptions> = {}) => {
    const notices: PluginFileNotice[] = [];
    const result = await plugin.run(
      mockPluginParams<TOptions>({
        ...defaults,
        ...overrides,
        text,
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );
    return { result, notices };
  };
}

export function mockDiagnostic(
  text: string,
  errorText: string,
  overrides: Partial<ts.DiagnosticWithLocation> = {},
): WithoutFile<ts.DiagnosticWithLocation> {
  const index = text.indexOf(errorText);
  if (index === -1) {
    throw new Error(`Did not find ${errorText} in ${text}`);
  }

  return {
    messageText: 'diagnostic message',
    start: index,
    length: errorText.length,
    category: ts.DiagnosticCategory.Error,
    code: 123,
    ...overrides,
  };
}

export async function realPluginParams<TOptions = unknown>(params: {
  fileName?: string;
  text?: string;
  options?: TOptions;
  compilerOptions?: ts.CompilerOptions;
  extraFiles?: { [fileName: string]: string };
}): Promise<PluginParams<TOptions>> {
  const {
    fileName = 'file.ts',
    text = '',
    options = {},
    compilerOptions,
    extraFiles = {},
  } = params;

  // In-memory language service: only the test files live in memory; default
  // libs and anything else resolve from disk.
  const resolvedOptions: ts.CompilerOptions = { strict: true, ...compilerOptions };
  const rootFileName = `/${fileName}`;
  const files = new Map([
    [rootFileName, text],
    ...Object.entries(extraFiles).map(
      ([extraFileName, extraText]) => [`/${extraFileName}`, extraText] as const,
    ),
  ]);

  const serviceHost: ts.LanguageServiceHost = {
    getCompilationSettings: () => resolvedOptions,
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: () => '0',
    getScriptSnapshot: (name) => {
      const contents = files.get(name) ?? ts.sys.readFile(name);
      return contents !== undefined ? ts.ScriptSnapshot.fromString(contents) : undefined;
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
  };

  const languageService = ts.createLanguageService(serviceHost);
  const program = languageService.getProgram();
  const sourceFile = program && program.getSourceFile(rootFileName);
  if (!sourceFile) {
    throw new Error(`Failed to create source file: ${fileName}`);
  }

  return {
    options: options as unknown as TOptions,
    fileName: rootFileName,
    rootDir: __dirname,
    text,
    sourceFile,
    getLanguageService: () => languageService,
  };
}

const defaultCompilerOptions: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

/**
 * Params rooted in a real directory, for a plugin whose validation programs
 * read every file but the one under migration from disk. `realPluginParams`
 * roots at `/`, where nothing outside the map it is given resolves, which is
 * the wrong answer for a plugin that has to see `react` or a sibling module
 * resolve the way it would in a project.
 */
export function fixturePluginParams<TOptions = unknown>(params: {
  /** The directory the program is rooted in. Its files resolve from disk. */
  rootDir: string;
  /** The file under migration, inside rootDir. Only ever read from memory. */
  fileName: string;
  text: string;
  options?: TOptions;
  /** Merged over the defaults, for the jsx and resolution a suite needs. */
  compilerOptions?: ts.CompilerOptions;
  /** More in-memory files, named relative to rootDir. */
  extraFiles?: FileMap;
  /** Pass one to share parsed source files across a suite's calls. */
  documentRegistry?: ts.DocumentRegistry;
}): PluginParams<TOptions> {
  const { rootDir, fileName, text, options, compilerOptions, extraFiles = {} } = params;

  const files = new Map<string, string>([
    [fileName, text],
    ...Object.entries(extraFiles).map(
      ([name, contents]) => [path.resolve(rootDir, name), contents] as const,
    ),
  ]);
  const resolvedOptions = { ...defaultCompilerOptions, ...compilerOptions };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => resolvedOptions,
    getScriptFileNames: () => Array.from(files.keys()),
    // Derived from the contents, so a shared document registry never hands
    // back the source file of a previous test under the same name.
    getScriptVersion: (name) => files.get(name) ?? '0',
    getScriptSnapshot: (name) => {
      const contents = files.get(name) ?? ts.sys.readFile(name);
      return contents !== undefined ? ts.ScriptSnapshot.fromString(contents) : undefined;
    },
    getCurrentDirectory: () => rootDir,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
    directoryExists: (name) => ts.sys.directoryExists(name),
    getDirectories: (name) => ts.sys.getDirectories(name),
  };

  const languageService = ts.createLanguageService(host, params.documentRegistry);
  const sourceFile = languageService.getProgram()?.getSourceFile(fileName);
  if (!sourceFile) throw new Error(`Failed to create source file: ${fileName}`);

  return {
    options: (options ?? {}) as TOptions,
    fileName,
    rootDir,
    text,
    sourceFile,
    getLanguageService: () => languageService,
  };
}

/** Parsed once: every check pulls in the same lib files. */
const libSourceFiles = new Map<string, ts.SourceFile | undefined>();

export interface TypeCheckerDefaults {
  /** The directory the program is rooted in. Defaults to `/`, nothing on disk. */
  rootDir?: string;
  /** The name the single-file form gives its text. */
  fileName?: string;
  /** Merged over the defaults shared with `fixturePluginParams`. */
  compilerOptions?: ts.CompilerOptions;
  /** Files every check needs, such as a module stub the input imports. */
  sharedFiles?: FileMap;
  /**
   * Drops the diagnostics of files read from disk, for a suite whose input
   * imports a real dependency it is not asserting on.
   */
  ownFilesOnly?: boolean;
}

/**
 * A type checker bound to the root, options and shared files a suite's checks
 * have in common. The returned function takes either the text of the one file
 * under test or a map of file names to text, and returns the diagnostics as
 * `TS<code>: <message>` strings.
 */
export function createTypeChecker(defaults: TypeCheckerDefaults = {}) {
  const { rootDir = '/', fileName = '/checked.ts', sharedFiles = {}, ownFilesOnly } = defaults;
  const options: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    // A check asserts on the text it is given. Without this the program pulls
    // in every @types package this repository installs, and reports their
    // problems as the input's.
    types: [],
    ...defaults.compilerOptions,
  };

  return (input: string | FileMap): string[] => {
    const files: FileMap = {
      ...sharedFiles,
      ...(typeof input === 'string' ? { [fileName]: input } : input),
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name, languageVersion) => {
        if (!(name in files)) {
          // A lib or a dependency read from disk, so its text cannot change
          // between checks the way the files under test do.
          if (!libSourceFiles.has(name)) {
            const libText = ts.sys.readFile(name);
            libSourceFiles.set(
              name,
              libText === undefined
                ? undefined
                : ts.createSourceFile(name, libText, languageVersion, true),
            );
          }
          return libSourceFiles.get(name);
        }
        return ts.createSourceFile(name, files[name], languageVersion, true);
      },
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      writeFile: () => {},
      getCurrentDirectory: () => rootDir,
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => '\n',
      fileExists: (name) => name in files || ts.sys.fileExists(name),
      readFile: (name) => files[name] ?? ts.sys.readFile(name),
      directoryExists: (name) => ts.sys.directoryExists(name),
      getDirectories: (name) => ts.sys.getDirectories(name),
    };
    const program = ts.createProgram(Object.keys(files), options, host);
    return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
      .filter((diagnostic) => !ownFilesOnly || (diagnostic.file?.fileName ?? '') in files)
      .map(
        (diagnostic) =>
          `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      );
  };
}

/** Compiles the given text in memory, resolving the lib files from disk. */
export const typeCheck = createTypeChecker();

export interface MidRunFile {
  onDisk: string;
  inRun?: string;
}

/**
 * Models the state a migration is in when it reaches a file: the run has
 * already produced new text for some files, but nothing is persisted until
 * the run ends, so the copies on disk are still the originals. The files are
 * written under a real directory, since the validation harness reads
 * dependencies it is not given from disk.
 */
export function midRunProject(tmpDir: string, files: { [name: string]: MidRunFile }) {
  const inRun = new Map<string, string>();
  const versions = new Map<string, number>();
  const fileOf = (name: string) => path.join(tmpDir, name);
  Object.entries(files).forEach(([name, texts]) => {
    fs.writeFileSync(fileOf(name), texts.onDisk);
    inRun.set(fileOf(name), texts.inRun ?? texts.onDisk);
  });

  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.Latest,
  };
  const read = (name: string) => (inRun.has(name) ? inRun.get(name) : ts.sys.readFile(name));
  const serviceHost: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => Array.from(inRun.keys()),
    getScriptVersion: (name) => String(versions.get(name) ?? 0),
    getScriptSnapshot: (name) => {
      const text = read(name);
      return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
    },
    getCurrentDirectory: () => tmpDir,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => inRun.has(name) || ts.sys.fileExists(name),
    readFile: read,
  };
  const languageService = ts.createLanguageService(serviceHost);

  return {
    // What the runner does with a plugin's result: the new text lives in the
    // run and nothing reaches disk.
    rewrite(name: string, text: string) {
      inRun.set(fileOf(name), text);
      versions.set(fileOf(name), (versions.get(fileOf(name)) ?? 0) + 1);
    },
    paramsFor<TOptions = unknown>(name: string, options?: TOptions): PluginParams<TOptions> {
      const sourceFile = languageService.getProgram()?.getSourceFile(fileOf(name));
      if (!sourceFile) throw new Error(`Failed to create source file: ${name}`);
      return {
        options: (options ?? {}) as TOptions,
        fileName: fileOf(name),
        rootDir: tmpDir,
        text: sourceFile.text,
        sourceFile,
        getLanguageService: () => languageService,
      };
    },
  };
}
