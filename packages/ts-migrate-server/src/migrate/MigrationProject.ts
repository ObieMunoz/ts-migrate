import ts from 'typescript';
import path from 'path';

interface CreateProjectParams {
  tsConfigFilePath: string;
  skipAddingFilesFromTsConfig?: boolean;
}

interface FileOverlay {
  text: string;
  version: number;
}

const hasGlobMagic = (pattern: string): boolean => /[*?{}[\]]/.test(pattern);

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const normalizeSlashes = (fileName: string): string => fileName.split(path.sep).join('/');

/**
 * A minimal project abstraction backed by the `typescript` package's
 * LanguageService, so plugins receive ASTs from the same TypeScript instance
 * they import (SyntaxKind numbering differs across compiler versions).
 *
 * File contents live in an in-memory overlay on top of the real filesystem;
 * updateSourceFile only touches the overlay, and callers decide when to
 * persist to disk.
 */
export default class MigrationProject {
  private readonly compilerOptions: ts.CompilerOptions;

  private readonly rootFileNames: Set<string>;

  private readonly overlays = new Map<string, FileOverlay>();

  private readonly languageService: ts.LanguageService;

  private projectVersion = 0;

  constructor({ tsConfigFilePath, skipAddingFilesFromTsConfig }: CreateProjectParams) {
    const configHost: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine));
      },
    };
    const parsedConfig = ts.getParsedCommandLineOfConfigFile(
      tsConfigFilePath,
      undefined,
      configHost,
    );
    if (!parsedConfig) {
      throw new Error(`Unable to parse config file: ${tsConfigFilePath}`);
    }

    this.compilerOptions = parsedConfig.options;
    this.rootFileNames = new Set(
      skipAddingFilesFromTsConfig ? [] : parsedConfig.fileNames.map(normalizeSlashes),
    );

    const serviceHost: ts.LanguageServiceHost = {
      getCompilationSettings: () => this.compilerOptions,
      getProjectVersion: () => String(this.projectVersion),
      getScriptFileNames: () => Array.from(this.rootFileNames),
      getScriptVersion: (fileName) =>
        String(this.overlays.get(normalizeSlashes(fileName))?.version ?? 0),
      getScriptSnapshot: (fileName) => {
        const text = this.readFile(fileName);
        return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
      },
      getCurrentDirectory: () => path.dirname(tsConfigFilePath),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) =>
        this.overlays.has(normalizeSlashes(fileName)) || ts.sys.fileExists(fileName),
      readFile: (fileName) => this.readFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };

    this.languageService = ts.createLanguageService(
      serviceHost,
      ts.createDocumentRegistry(
        ts.sys.useCaseSensitiveFileNames,
        serviceHost.getCurrentDirectory(),
      ),
    );
  }

  /**
   * Add files to the project by exact path or glob pattern (tsconfig-style
   * globs: `*`, `?`, `**`). Patterns that match nothing are skipped silently.
   */
  addSourceFilesByPaths(filePathsOrGlobs: string[]): void {
    filePathsOrGlobs.forEach((pattern) => {
      if (hasGlobMagic(pattern)) {
        const baseDir = path.dirname(pattern.split(/[*?{[]/)[0]);
        ts.sys
          .readDirectory(baseDir, SCRIPT_EXTENSIONS, undefined, [pattern])
          .forEach((fileName) => this.rootFileNames.add(normalizeSlashes(fileName)));
      } else if (ts.sys.fileExists(pattern)) {
        this.rootFileNames.add(normalizeSlashes(pattern));
      }
    });
    this.projectVersion += 1;
  }

  getLanguageService(): ts.LanguageService {
    return this.languageService;
  }

  getCompilerOptions(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  private getProgram(): ts.Program {
    const program = this.languageService.getProgram();
    if (!program) {
      throw new Error('Failed to create TypeScript program.');
    }
    return program;
  }

  getSourceFiles(): ts.SourceFile[] {
    const program = this.getProgram();
    return Array.from(this.rootFileNames)
      .map((fileName) => program.getSourceFile(fileName))
      .filter((sourceFile): sourceFile is ts.SourceFile => sourceFile !== undefined);
  }

  getSourceFileOrThrow(fileName: string): ts.SourceFile {
    const sourceFile = this.getProgram().getSourceFile(fileName);
    if (!sourceFile) {
      throw new Error(`Could not find source file: ${fileName}`);
    }
    return sourceFile;
  }

  updateSourceFile(fileName: string, text: string): void {
    const normalized = normalizeSlashes(fileName);
    const previousVersion = this.overlays.get(normalized)?.version ?? 0;
    this.overlays.set(normalized, { text, version: previousVersion + 1 });
    this.projectVersion += 1;
  }

  private readFile(fileName: string): string | undefined {
    return this.overlays.get(normalizeSlashes(fileName))?.text ?? ts.sys.readFile(fileName);
  }
}
