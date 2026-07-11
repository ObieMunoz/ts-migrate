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

interface CachedModuleResolutionHost extends ts.ModuleResolutionHost {
  fileExists(fileName: string): boolean;
  readFile(fileName: string): string | undefined;
  directoryExists(directoryName: string): boolean;
  getDirectories(directoryName: string): string[];
}

// The language service reads host.getModuleResolutionCache at runtime (the
// program reuses its packageJsonInfoCache), but the method is marked
// @internal on ts.LanguageServiceHost and missing from the public type.
interface LanguageServiceHostWithCache extends ts.LanguageServiceHost {
  getModuleResolutionCache?(): ts.ModuleResolutionCache | undefined;
}

/**
 * A module resolution host whose filesystem probes are memoized forever:
 * on-disk state is stable for a project's lifetime because edits live in the
 * overlay and are persisted only after migration finishes.
 */
const createCachedModuleResolutionHost = (currentDirectory: string): CachedModuleResolutionHost => {
  const memo = <T>(cache: Map<string, T>, key: string, compute: (key: string) => T): T => {
    if (!cache.has(key)) {
      cache.set(key, compute(key));
    }
    return cache.get(key) as T;
  };
  const fileText = new Map<string, string | undefined>();
  const filePresence = new Map<string, boolean>();
  const directoryPresence = new Map<string, boolean>();
  const directoryNames = new Map<string, string[]>();
  const realpaths = new Map<string, string>();
  const sysRealpath = ts.sys.realpath;
  return {
    fileExists: (fileName) => memo(filePresence, fileName, ts.sys.fileExists),
    readFile: (fileName) => memo(fileText, fileName, ts.sys.readFile),
    directoryExists: (directoryName) =>
      memo(directoryPresence, directoryName, ts.sys.directoryExists),
    getDirectories: (directoryName) => memo(directoryNames, directoryName, ts.sys.getDirectories),
    ...(sysRealpath ? { realpath: (p: string) => memo(realpaths, p, sysRealpath) } : undefined),
    getCurrentDirectory: () => currentDirectory,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
};

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

  private readonly moduleResolutionHost: CachedModuleResolutionHost;

  private readonly moduleResolutionCache: ts.ModuleResolutionCache;

  private readonly typeReferenceDirectiveResolutionCache: ts.TypeReferenceDirectiveResolutionCache;

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

    const currentDirectory = path.dirname(tsConfigFilePath);
    const getCanonicalFileName = ts.sys.useCaseSensitiveFileNames
      ? (fileName: string) => fileName
      : (fileName: string) => fileName.toLowerCase();
    this.moduleResolutionHost = createCachedModuleResolutionHost(currentDirectory);
    this.moduleResolutionCache = ts.createModuleResolutionCache(
      currentDirectory,
      getCanonicalFileName,
      this.compilerOptions,
    );
    this.typeReferenceDirectiveResolutionCache = ts.createTypeReferenceDirectiveResolutionCache(
      currentDirectory,
      getCanonicalFileName,
      this.compilerOptions,
      this.moduleResolutionCache.getPackageJsonInfoCache(),
    );

    const serviceHost: LanguageServiceHostWithCache = {
      getCompilationSettings: () => this.compilerOptions,
      getProjectVersion: () => String(this.projectVersion),
      getScriptFileNames: () => Array.from(this.rootFileNames),
      getScriptVersion: (fileName) =>
        String(this.overlays.get(normalizeSlashes(fileName))?.version ?? 0),
      getScriptSnapshot: (fileName) => {
        const text = this.readFile(fileName);
        return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
      },
      getCurrentDirectory: () => currentDirectory,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) =>
        this.overlays.has(normalizeSlashes(fileName)) ||
        this.moduleResolutionHost.fileExists(fileName),
      readFile: (fileName) => this.readFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: this.moduleResolutionHost.directoryExists,
      getDirectories: this.moduleResolutionHost.getDirectories,
      realpath: this.moduleResolutionHost.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      // Resolving through the shared caches (instead of the per-program cache
      // each program rebuild starts with) is sound because module resolution
      // inputs never change during a migration: renames happen in the earlier
      // `rename` command and overlay edits are persisted only at the end.
      resolveModuleNameLiterals: (
        moduleLiterals,
        containingFile,
        redirectedReference,
        options,
        containingSourceFile,
      ) =>
        moduleLiterals.map((literal) =>
          ts.resolveModuleName(
            literal.text,
            containingFile,
            options,
            this.moduleResolutionHost,
            this.moduleResolutionCache,
            redirectedReference,
            ts.getModeForUsageLocation(containingSourceFile, literal, options),
          ),
        ),
      resolveTypeReferenceDirectiveReferences: (
        typeDirectiveReferences,
        containingFile,
        redirectedReference,
        options,
        containingSourceFile,
      ) =>
        typeDirectiveReferences.map((reference) =>
          ts.resolveTypeReferenceDirective(
            typeof reference === 'string' ? reference : reference.fileName,
            containingFile,
            options,
            this.moduleResolutionHost,
            redirectedReference,
            this.typeReferenceDirectiveResolutionCache,
            ts.getModeForFileReference(reference, containingSourceFile?.impliedNodeFormat),
          ),
        ),
      getModuleResolutionCache: () => this.moduleResolutionCache,
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

  /** The project-wide resolution host and cache, for reuse outside the language service. */
  getModuleResolution(): { host: ts.ModuleResolutionHost; cache: ts.ModuleResolutionCache } {
    return { host: this.moduleResolutionHost, cache: this.moduleResolutionCache };
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
    return (
      this.overlays.get(normalizeSlashes(fileName))?.text ??
      this.moduleResolutionHost.readFile(fileName)
    );
  }
}
