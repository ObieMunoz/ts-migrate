/**
 * The harness a plugin re-checks a proposed edit with: a single-file language
 * service over the candidate text, whose errors are diffed against the
 * baseline's.
 *
 * Three things it does not do, each of which the caller has to handle itself.
 *
 * A type the checker resolved to `any` has to be rejected before validation
 * rather than by it. `any` is assignable to everything, so an edit built on
 * one never produces a new error and always reads as proven. A two-way
 * `isTypeAssignableTo` veto does not catch it either, because `any` answers
 * true in both directions; it takes an explicit `ts.TypeFlags.Any` test on the
 * checker's type ahead of the call. Measurements are in
 * https://github.com/ObieMunoz/ts-migrate/issues/146#issuecomment-5077134220.
 *
 * Candidate text spells the any alias `any`, and only the text the plugin
 * emits gets the configured `anyAlias`. The alias is declared in a file a
 * single-file program does not see, so `$TSFixMe` in candidate text reports
 * TS2304 and every aliased candidate comes back rejected.
 *
 * No new error is not on its own evidence that the edit did anything: an edit
 * that accomplishes nothing produces no new error either. A caller should also
 * require that the diagnostics it made the edit for are gone.
 */
import path from 'path';
import ts from 'typescript';
import updateSourceText, { SourceTextUpdate } from './updateSourceText';

export interface TextChange {
  start: number;
  length: number;
  text: string;
}

export function applyTextChanges(text: string, changes: TextChange[]): string {
  const updates: SourceTextUpdate[] = changes.map((change) =>
    change.length === 0
      ? { kind: 'insert', index: change.start, text: change.text }
      : { kind: 'replace', index: change.start, length: change.length, text: change.text },
  );
  return updateSourceText(text, updates);
}

export function toCandidatePos(originalPos: number, changes: TextChange[]): number {
  let shift = 0;
  changes.forEach((change) => {
    if (change.start <= originalPos) {
      shift += change.text.length - change.length;
    }
  });
  return originalPos + shift;
}

export function toOriginalPos(candidatePos: number, changes: TextChange[]): number {
  let shift = 0;
  for (const change of changes) {
    if (change.start + shift >= candidatePos) break;
    shift += change.text.length - change.length;
  }
  return candidatePos - shift;
}

/**
 * Errors the candidate text has and the baseline text does not. Diffing
 * cancels out the file's pre-existing errors, including the ones a
 * single-file program reports for declarations it cannot see.
 */
export function findNewErrors(
  baseline: ts.LanguageService,
  candidate: ts.LanguageService,
  changes: TextChange[],
  fileName: string,
): ts.Diagnostic[] {
  const isError = (d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error;
  // Checked first: a clean candidate never type-checks the baseline (the
  // baseline service stays lazy until its first query).
  const candidateErrors = candidate.getSemanticDiagnostics(fileName).filter(isError);
  if (candidateErrors.length === 0) {
    return [];
  }
  const baselineKeys = new Set(
    baseline
      .getSemanticDiagnostics(fileName)
      .filter(isError)
      .map((d) => `${d.code}:${d.start == null ? '' : toCandidatePos(d.start, changes)}`),
  );
  return candidateErrors.filter(
    (d) => !baselineKeys.has(`${d.code}:${d.start == null ? '' : d.start}`),
  );
}

// Parsed and bound dependency files (default libs, node_modules, the import
// graph) and disk reads are shared across all validation services: disk
// content is stable for the whole run because migrate persists overlay
// changes only at the very end. Only the file under migration and the
// dependencies the run has already rewritten differ between services, so
// those get fresh versions and everything else stays cached in the registry.
const sharedDocumentRegistry = ts.createDocumentRegistry(
  ts.sys.useCaseSensitiveFileNames,
  ts.sys.getCurrentDirectory(),
);
const diskFileText = new Map<string, string | undefined>();
const diskFilePresence = new Map<string, boolean>();
const diskDirectoryPresence = new Map<string, boolean>();
const diskDirectoryNames = new Map<string, string[]>();
const diskRealpaths = new Map<string, string>();
let overrideVersion = 0;

function readFileCached(name: string): string | undefined {
  if (!diskFileText.has(name)) {
    diskFileText.set(name, ts.sys.readFile(name));
  }
  return diskFileText.get(name);
}

function fileExistsCached(name: string): boolean {
  let exists = diskFilePresence.get(name);
  if (exists === undefined) {
    exists = ts.sys.fileExists(name);
    diskFilePresence.set(name, exists);
  }
  return exists;
}

function directoryExistsCached(name: string): boolean {
  let exists = diskDirectoryPresence.get(name);
  if (exists === undefined) {
    exists = ts.sys.directoryExists(name);
    diskDirectoryPresence.set(name, exists);
  }
  return exists;
}

function getDirectoriesCached(name: string): string[] {
  let directories = diskDirectoryNames.get(name);
  if (directories === undefined) {
    directories = ts.sys.getDirectories(name);
    diskDirectoryNames.set(name, directories);
  }
  return directories;
}

const sysRealpath = ts.sys.realpath;
const realpathCached =
  sysRealpath &&
  ((name: string): string => {
    let real = diskRealpaths.get(name);
    if (real === undefined) {
      real = sysRealpath(name);
      diskRealpaths.set(name, real);
    }
    return real;
  });

// A ModuleResolutionCache assumes every lookup uses the options it was
// created with, so caches are keyed by options object; run() derives one
// stable options object per program, giving one cache shared by all of a
// run's validation services. Resolutions are as stable as the disk reads
// above: renames happen in the earlier `rename` command.
interface ResolutionCaches {
  moduleResolutionCache: ts.ModuleResolutionCache;
  typeReferenceDirectiveResolutionCache: ts.TypeReferenceDirectiveResolutionCache;
}
const resolutionCachesByOptions = new WeakMap<ts.CompilerOptions, ResolutionCaches>();

function getResolutionCaches(compilerOptions: ts.CompilerOptions): ResolutionCaches {
  let caches = resolutionCachesByOptions.get(compilerOptions);
  if (!caches) {
    const currentDirectory = ts.sys.getCurrentDirectory();
    const getCanonicalFileName = ts.sys.useCaseSensitiveFileNames
      ? (fileName: string) => fileName
      : (fileName: string) => fileName.toLowerCase();
    const moduleResolutionCache = ts.createModuleResolutionCache(
      currentDirectory,
      getCanonicalFileName,
      compilerOptions,
    );
    caches = {
      moduleResolutionCache,
      typeReferenceDirectiveResolutionCache: ts.createTypeReferenceDirectiveResolutionCache(
        currentDirectory,
        getCanonicalFileName,
        compilerOptions,
        moduleResolutionCache.getPackageJsonInfoCache(),
      ),
    };
    resolutionCachesByOptions.set(compilerOptions, caches);
  }
  return caches;
}

const validationOptionsByProgramOptions = new WeakMap<ts.CompilerOptions, ts.CompilerOptions>();

export function getValidationOptions(programOptions: ts.CompilerOptions): ts.CompilerOptions {
  let options = validationOptionsByProgramOptions.get(programOptions);
  if (!options) {
    options = { ...programOptions, skipLibCheck: true };
    validationOptionsByProgramOptions.set(programOptions, options);
  }
  return options;
}

// The language service reads host.getModuleResolutionCache at runtime (the
// program reuses its packageJsonInfoCache), but the method is marked
// @internal on ts.LanguageServiceHost and missing from the public type.
interface LanguageServiceHostWithCache extends ts.LanguageServiceHost {
  getModuleResolutionCache?(): ts.ModuleResolutionCache | undefined;
}

// Text a dependency has in the run rather than on disk, where the
// pre-migration copy sits until the run ends. Judging a candidate against
// that copy judges it against a file that will not exist when the run
// finishes.
//
// Each source file object gets its own version, so the shared registry, which
// reuses a cached file whenever the version matches without comparing
// content, never serves one revision of a dependency in place of another.
//
// Versions live in two namespaces: `dN` for a file the run can rewrite, `'0'`
// for one it cannot. The program is a required argument for that reason. The
// registry outlives any one plugin, so a file that can change must never land
// in the `'0'` namespace, where the entry holds the disk copy and the next
// caller asking for `'0'` gets it back whatever the run has since written.
const dependencyVersions = new WeakMap<ts.SourceFile, string>();
let dependencyVersion = 0;

// Most of a validation program is default libs and node_modules, which the
// runner excludes from migration and so cannot change. Ruling them out by
// name keeps the lookup off them: resolving one costs a path
// canonicalization, and the host asks for every file in the program several
// times over.
function couldBeMigrated(name: string): boolean {
  return !name.includes('/node_modules/') && !name.endsWith('.d.ts');
}

function currentDependency(
  projectProgram: ts.Program | undefined,
  name: string,
): { text: string; version: string } | undefined {
  if (!projectProgram || !couldBeMigrated(name)) return undefined;
  const sourceFile = projectProgram.getSourceFile(name);
  if (!sourceFile) return undefined;
  let version = dependencyVersions.get(sourceFile);
  if (version === undefined) {
    dependencyVersion += 1;
    version = `d${dependencyVersion}`;
    dependencyVersions.set(sourceFile, version);
  }
  return { text: sourceFile.text, version };
}

export function createFileLanguageService(
  fileName: string,
  content: string,
  compilerOptions: ts.CompilerOptions,
  projectProgram: ts.Program | undefined,
): ts.LanguageService {
  // Only the file under migration is overridden; default libs and anything the
  // run does not track resolve from disk. The shared registry reuses cached
  // files purely by version, so the overridden file must never repeat one for
  // different content.
  overrideVersion += 1;
  const version = String(overrideVersion);
  const dependencyText = (name: string) =>
    currentDependency(projectProgram, name)?.text ?? readFileCached(name);
  const { moduleResolutionCache, typeReferenceDirectiveResolutionCache } =
    getResolutionCaches(compilerOptions);
  const getCurrentDirectory = () => path.dirname(fileName);
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: fileExistsCached,
    readFile: readFileCached,
    directoryExists: directoryExistsCached,
    getDirectories: getDirectoriesCached,
    ...(realpathCached ? { realpath: realpathCached } : undefined),
    getCurrentDirectory,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
  const host: LanguageServiceHostWithCache = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [fileName],
    getScriptVersion: (name) =>
      name === fileName ? version : (currentDependency(projectProgram, name)?.version ?? '0'),
    getScriptSnapshot: (name) => {
      const contents = name === fileName ? content : dependencyText(name);
      return contents !== undefined ? ts.ScriptSnapshot.fromString(contents) : undefined;
    },
    getCurrentDirectory,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (name) => name === fileName || fileExistsCached(name),
    readFile: (name) => (name === fileName ? content : dependencyText(name)),
    directoryExists: directoryExistsCached,
    getDirectories: getDirectoriesCached,
    ...(realpathCached ? { realpath: realpathCached } : undefined),
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
          resolutionHost,
          moduleResolutionCache,
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
          resolutionHost,
          redirectedReference,
          typeReferenceDirectiveResolutionCache,
          ts.getModeForFileReference(reference, containingSourceFile?.impliedNodeFormat),
        ),
      ),
    getModuleResolutionCache: () => moduleResolutionCache,
  };
  return ts.createLanguageService(host, sharedDocumentRegistry);
}
