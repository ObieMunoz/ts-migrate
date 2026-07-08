import ts from 'typescript';
import { PluginParams } from '@obiemunoz/ts-migrate-server';

type WithoutFile<T> = Omit<T, 'file'>;

export function mockPluginParams<TOptions = unknown>(params: {
  fileName?: string;
  text?: string;
  semanticDiagnostics?: WithoutFile<ts.Diagnostic>[];
  syntacticDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  suggestionDiagnostics?: WithoutFile<ts.DiagnosticWithLocation>[];
  options?: TOptions;
}): PluginParams<TOptions> {
  const {
    fileName = 'file.ts',
    text = '',
    semanticDiagnostics = [],
    syntacticDiagnostics = [],
    suggestionDiagnostics = [],
    options = {},
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
    getLanguageService: () =>
      ({
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
}): Promise<PluginParams<TOptions>> {
  const { fileName = 'file.ts', text = '', options = {}, compilerOptions } = params;

  // In-memory language service: only the test file lives in memory; default
  // libs and anything else resolve from disk.
  const resolvedOptions: ts.CompilerOptions = { strict: true, ...compilerOptions };
  const rootFileName = `/${fileName}`;
  const files = new Map([[rootFileName, text]]);

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
