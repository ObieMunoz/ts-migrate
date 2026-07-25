import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { PluginFileNotice, PluginParams } from '@obiemunoz/ts-migrate-server';

type WithoutFile<T> = Omit<T, 'file'>;

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

export function mockPluginParams<TOptions = unknown>(params: {
  fileName?: string;
  text?: string;
  semanticDiagnostics?: WithoutFile<ts.Diagnostic>[];
  syntacticDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  suggestionDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  options?: TOptions;
  /** Set to collect what the plugin reports, as the runner does. */
  reportFileNotice?: (notice: PluginFileNotice) => void;
}): PluginParams<TOptions> {
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

/** Compiles the given text in memory, resolving the lib files from disk. */
export function typeCheck(text: string, compilerOptions?: ts.CompilerOptions): string[] {
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
