import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import pluralize from './pluralize';

type EnvKey = 'node' | 'testRunner' | 'jquery' | 'bun';

// TypeScript's dedicated "install type definitions" diagnostics. The second
// code of each pair is the variant emitted when the tsconfig has a "types"
// array ("...and then add 'x' to the types field").
const CODE_TO_ENV: { [code: number]: EnvKey } = {
  2580: 'node',
  2591: 'node',
  2582: 'testRunner',
  2593: 'testRunner',
  2581: 'jquery',
  2592: 'jquery',
  2867: 'bun',
  2868: 'bun',
};

// Environment globals the compiler reports as plain TS2304/TS2503 rather than
// one of the dedicated codes above.
const NAME_TO_ENV: { [name: string]: EnvKey } = {
  __dirname: 'node',
  __filename: 'node',
  exports: 'node',
  global: 'node',
  setImmediate: 'node',
  clearImmediate: 'node',
  NodeJS: 'node',
  beforeEach: 'testRunner',
  afterEach: 'testRunner',
  beforeAll: 'testRunner',
  afterAll: 'testRunner',
  expect: 'testRunner',
  jest: 'testRunner',
  vi: 'testRunner',
  jasmine: 'testRunner',
  fdescribe: 'testRunner',
  xdescribe: 'testRunner',
  fit: 'testRunner',
  xit: 'testRunner',
};

const NODE_BUILTINS = new Set(builtinModules);

interface EnvEvidence {
  errorCount: number;
  weakCount: number;
  names: Set<string>;
  files: Set<string>;
}

interface ModuleEvidence {
  errorCount: number;
  files: Set<string>;
}

export interface TypesEvidence {
  env: Map<EnvKey, EnvEvidence>;
  untypedModules: Map<string, ModuleEvidence>;
  compilerTypes?: readonly string[];
  compilerTypesCaptured: boolean;
}

export function createTypesEvidence(): TypesEvidence {
  return { env: new Map(), untypedModules: new Map(), compilerTypesCaptured: false };
}

export interface TypesDiagnostic {
  code: number;
  messageText: string | ts.DiagnosticMessageChain;
}

const QUOTED_NAME = /'([^']+)'/;

function firstMessageLine(diagnostic: TypesDiagnostic): string {
  return typeof diagnostic.messageText === 'string'
    ? diagnostic.messageText
    : diagnostic.messageText.messageText;
}

function envEvidence(evidence: TypesEvidence, key: EnvKey): EnvEvidence {
  let env = evidence.env.get(key);
  if (!env) {
    env = { errorCount: 0, weakCount: 0, names: new Set(), files: new Set() };
    evidence.env.set(key, env);
  }
  return env;
}

function addEnvError(evidence: TypesEvidence, key: EnvKey, fileName: string, name?: string): void {
  const env = envEvidence(evidence, key);
  env.errorCount += 1;
  env.files.add(fileName);
  if (name) env.names.add(name);
}

export function collectTypesEvidence(
  evidence: TypesEvidence,
  fileName: string,
  diagnostics: readonly TypesDiagnostic[],
): void {
  diagnostics.forEach((diagnostic) => {
    const { code } = diagnostic;
    const match = QUOTED_NAME.exec(firstMessageLine(diagnostic));
    const quoted = match ? match[1] : undefined;

    const envFromCode = CODE_TO_ENV[code];
    if (envFromCode) {
      addEnvError(evidence, envFromCode, fileName, quoted);
      return;
    }

    if ((code === 2304 || code === 2503) && quoted && NAME_TO_ENV[quoted]) {
      addEnvError(evidence, NAME_TO_ENV[quoted], fileName, quoted);
      return;
    }

    // For `console` the compiler suggests adding the "dom" lib, but alongside
    // other node globals the actual fix is @types/node.
    if (code === 2584 && quoted === 'console') {
      const env = envEvidence(evidence, 'node');
      env.weakCount += 1;
      env.files.add(fileName);
      return;
    }

    if ((code === 2307 || code === 7016) && quoted) {
      if (quoted.startsWith('.') || path.isAbsolute(quoted)) return;
      const bareName = quoted.startsWith('node:') ? quoted.slice('node:'.length) : quoted;
      if (NODE_BUILTINS.has(quoted) || NODE_BUILTINS.has(bareName)) {
        addEnvError(evidence, 'node', fileName, quoted);
        return;
      }
      // TS2307 without a resolvable implementation is a missing dependency,
      // not a missing @types package.
      if (code !== 7016) return;
      let module = evidence.untypedModules.get(quoted);
      if (!module) {
        module = { errorCount: 0, files: new Set() };
        evidence.untypedModules.set(quoted, module);
      }
      module.errorCount += 1;
      module.files.add(fileName);
    }
  });
}

interface PackageJson {
  name?: string;
  version?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  engines?: { node?: string };
  workspaces?: unknown;
  packageManager?: unknown;
  dependencies?: { [name: string]: string };
  devDependencies?: { [name: string]: string };
}

function readJson(filePath: string): PackageJson | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Walk up from `startDir` until `probe` answers. `isBoundary` stops the walk
 * after the directory it matches has itself been probed, so the boundary is
 * inclusive.
 */
function findUp<T>(
  startDir: string,
  probe: (dir: string) => T | undefined,
  isBoundary?: (dir: string) => boolean,
): T | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const result = probe(dir);
    if (result !== undefined) return result;
    if (isBoundary?.(dir)) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The top of the project, past which an upward search is reading somebody
 * else's files. Worktrees and submodules write `.git` as a file rather than a
 * directory, and a checkout that carries no git metadata at all still has its
 * workspace manifest, so both signals are needed.
 */
function isProjectRoot(dir: string): boolean {
  if (fs.existsSync(path.join(dir, '.git'))) return true;
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return true;
  if (fs.existsSync(path.join(dir, 'lerna.json'))) return true;
  return readJson(path.join(dir, 'package.json'))?.workspaces !== undefined;
}

/** The migration root may be a subfolder of the package. */
function findNearestPackageJson(
  startDir: string,
): { dir: string; packageJson: PackageJson } | undefined {
  return findUp(startDir, (dir) => {
    const packageJson = readJson(path.join(dir, 'package.json'));
    return packageJson ? { dir, packageJson } : undefined;
  });
}

/** Resolve an installed package the way node would, honoring hoisted installs. */
function findInstalledPackage(
  startDir: string,
  packageName: string,
): { dir: string; packageJson: PackageJson } | undefined {
  return findUp(startDir, (dir) => {
    const packageDir = path.join(dir, 'node_modules', ...packageName.split('/'));
    const packageJson = readJson(path.join(packageDir, 'package.json'));
    return packageJson ? { dir: packageDir, packageJson } : undefined;
  });
}

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

const LOCKFILES: [string, PackageManager][] = [
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/**
 * Corepack's pin: a tool name, optionally an `@version`, optionally a `+hash`
 * suffix. The value is user-controlled text, so anything that does not name a
 * manager this module knows is treated as absent rather than guessed at.
 */
const PACKAGE_MANAGER_PIN = /^(npm|yarn|pnpm|bun)(?:@([^+\s]+))?(?:\+\S+)?$/;

interface PinnedPackageManager {
  packageManager: PackageManager;
  version?: string;
}

function parsePackageManagerField(value: unknown): PinnedPackageManager | undefined {
  if (typeof value !== 'string') return undefined;
  const match = PACKAGE_MANAGER_PIN.exec(value.trim());
  if (!match) return undefined;
  return { packageManager: match[1] as PackageManager, version: match[2] };
}

/**
 * In a monorepo the pin sits at the workspace root, above the package being
 * migrated, so this is a walk rather than a single read.
 */
function findPinnedPackageManager(startDir: string): PinnedPackageManager | undefined {
  return findUp(
    startDir,
    (dir) => parsePackageManagerField(readJson(path.join(dir, 'package.json'))?.packageManager),
    isProjectRoot,
  );
}

interface LockfileChoice {
  dir: string;
  file: string;
  packageManager: PackageManager;
  /** Said when mtime, the weakest of the signals, is what settled the choice. */
  note?: string;
}

interface LockfileCandidate {
  file: string;
  packageManager: PackageManager;
  mtimeMs: number;
}

function modifiedAt(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * One candidate per manager, each carrying that manager's newest file. Bun 1.2
 * writes the text `bun.lock` and can keep the binary `bun.lockb` beside it, so
 * the pair is one candidate rather than a conflict.
 */
function lockfileCandidatesIn(dir: string): LockfileCandidate[] {
  const candidates: LockfileCandidate[] = [];
  LOCKFILES.forEach(([file, packageManager]) => {
    const mtimeMs = modifiedAt(path.join(dir, file));
    if (mtimeMs === undefined) return;
    const existing = candidates.find((candidate) => candidate.packageManager === packageManager);
    if (!existing) {
      candidates.push({ file, packageManager, mtimeMs });
    } else if (mtimeMs > existing.mtimeMs) {
      existing.file = file;
      existing.mtimeMs = mtimeMs;
    }
  });
  return candidates;
}

function chosen(dir: string, { file, packageManager }: LockfileCandidate): LockfileChoice {
  return { dir, file, packageManager };
}

/**
 * Two lockfiles in one directory is the normal condition of a repository
 * partway through switching managers, and the accidental one left behind by
 * running the wrong tool once. Which manager gets reported should not come down
 * to the order of the table above.
 */
function chooseLockfile(
  dir: string,
  candidates: LockfileCandidate[],
  pinned: PackageManager | undefined,
): LockfileChoice {
  if (candidates.length === 1) return chosen(dir, candidates[0]);

  const pinnedCandidate = candidates.find(({ packageManager }) => packageManager === pinned);
  if (pinnedCandidate) return chosen(dir, pinnedCandidate);

  // Only pnpm reads it, so it decides for pnpm whatever the mtimes say.
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const pnpm = candidates.find(({ packageManager }) => packageManager === 'pnpm');
    if (pnpm) return chosen(dir, pnpm);
  }

  // Whichever tool ran last, as a proxy for the one the project is on.
  const [newest, ...rest] = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    ...chosen(dir, newest),
    note:
      `more than one lockfile is present; the install command follows ${newest.file} as the ` +
      `most recently modified, over ${rest.map(({ file }) => file).join(' and ')}.`,
  };
}

/**
 * The lockfile can sit several levels above the migration root, since in a
 * monorepo it only exists at the workspace root. It stops being the project's
 * lockfile above the project root, and recommending the wrong manager writes a
 * second lockfile into the repository, so the walk stops there.
 */
function findLockfile(
  startDir: string,
  pinned: PackageManager | undefined,
): LockfileChoice | undefined {
  return findUp(
    startDir,
    (dir) => {
      const candidates = lockfileCandidatesIn(dir);
      return candidates.length > 0 ? chooseLockfile(dir, candidates, pinned) : undefined;
    },
    isProjectRoot,
  );
}

/**
 * Yarn v1 refuses to add a dependency to a workspace root without `-W`; berry
 * dropped that check and rejects the unknown option, so the flag can only be
 * offered once the major is known. The lockfile is the fallback source: berry
 * opens with a `__metadata` block, v1 with a version header.
 */
function yarnGeneration(
  pinnedVersion: string | undefined,
  lockfile: LockfileChoice | undefined,
): 'v1' | 'berry' | undefined {
  const pinnedMajor = firstMajor(pinnedVersion);
  if (pinnedMajor !== undefined) return pinnedMajor === 1 ? 'v1' : 'berry';
  if (lockfile?.packageManager !== 'yarn') return undefined;
  let text: string;
  try {
    text = fs.readFileSync(path.join(lockfile.dir, lockfile.file), 'utf-8');
  } catch {
    return undefined;
  }
  if (/^# yarn lockfile v1$/m.test(text)) return 'v1';
  if (/^__metadata:$/m.test(text)) return 'berry';
  return undefined;
}

/**
 * The flag the manager needs to accept an install into a workspace root, or
 * undefined when the directory is not one or the manager has no such check.
 *
 * Each manager gets the signal it actually reads. pnpm goes by
 * `pnpm-workspace.yaml` alone — a `workspaces` field only earns a warning that
 * pnpm does not support it, and the install proceeds. yarn v1 goes by the
 * `workspaces` field. npm's `-w` selects a workspace by name rather than
 * escaping a check, so it must not be added there, and bun has no check.
 */
function workspaceRootFlag(
  packageManager: PackageManager,
  installDir: string,
  yarn: 'v1' | 'berry' | undefined,
): string | undefined {
  if (packageManager === 'pnpm') {
    return fs.existsSync(path.join(installDir, 'pnpm-workspace.yaml')) ? '-w' : undefined;
  }
  if (packageManager === 'yarn' && yarn === 'v1') {
    return readJson(path.join(installDir, 'package.json'))?.workspaces !== undefined
      ? '-W'
      : undefined;
  }
  return undefined;
}

/**
 * Where the install command has to run, said relative to the working directory
 * when it sits inside it. Undefined when they are the same directory, which is
 * the case that needs no explaining.
 */
function installDirLabel(installDir: string): string | undefined {
  const cwd = process.cwd();
  if (path.resolve(installDir) === path.resolve(cwd)) return undefined;
  const relative = path.relative(cwd, installDir);
  return relative && !relative.startsWith('..') ? relative : installDir;
}

interface PackageManagerDetection extends PinnedPackageManager {
  /** Said when the sources disagreed and something had to break the tie. */
  note?: string;
  /** The flag the manager needs to accept an install into a workspace root. */
  workspaceRootFlag?: string;
}

/**
 * A pinned `packageManager` is a deliberate statement about which tool the
 * project uses; a lockfile is a byproduct of having run one. The pin wins when
 * they disagree, which usually means a half finished switch between managers
 * and is worth saying out loud rather than resolving silently.
 */
function detectPackageManager(startDir: string, installDir: string): PackageManagerDetection {
  const pinned = findPinnedPackageManager(startDir);
  const lockfile = findLockfile(startDir, pinned?.packageManager);
  const packageManager = pinned?.packageManager ?? lockfile?.packageManager ?? 'npm';
  const flag = workspaceRootFlag(
    packageManager,
    installDir,
    yarnGeneration(pinned?.version, lockfile),
  );
  if (!pinned) {
    return { packageManager, note: lockfile?.note, workspaceRootFlag: flag };
  }

  // Any tie between lockfiles is moot here: the pin, not an mtime, is what the
  // install command follows.
  const pin = pinned.version ? `${pinned.packageManager}@${pinned.version}` : pinned.packageManager;
  const note =
    lockfile && lockfile.packageManager !== pinned.packageManager
      ? `package.json pins "packageManager": "${pin}" but a ${lockfile.file} was found; ` +
        'the install command follows the pinned field.'
      : undefined;
  return { ...pinned, note, workspaceRootFlag: flag };
}

const INSTALL_COMMANDS: { [key in PackageManager]: string } = {
  npm: 'npm install -D',
  yarn: 'yarn add -D',
  pnpm: 'pnpm add -D',
  bun: 'bun add -d',
};

function firstMajor(version: string | undefined): number | undefined {
  const match = /(\d+)/.exec(version ?? '');
  return match ? Number(match[1]) : undefined;
}

function detectNodeMajor(startDir: string, packageJson?: PackageJson): number | undefined {
  const fromEngines = firstMajor(packageJson?.engines?.node);
  if (fromEngines !== undefined) return fromEngines;
  const nvmrc = findUp(startDir, (dir) => {
    try {
      return fs.readFileSync(path.join(dir, '.nvmrc'), 'utf-8').trim();
    } catch {
      return undefined;
    }
  });
  const fromNvmrc = firstMajor(nvmrc);
  return fromNvmrc !== undefined ? fromNvmrc : firstMajor(process.versions.node);
}

function hasTypesCondition(exportsField: unknown): boolean {
  if (typeof exportsField !== 'object' || exportsField === null) return false;
  return Object.entries(exportsField).some(
    ([key, value]) => key === 'types' || hasTypesCondition(value),
  );
}

function packageShipsTypes(packageDir: string, packageJson: PackageJson): boolean {
  return Boolean(
    packageJson.types ||
      packageJson.typings ||
      hasTypesCondition(packageJson.exports) ||
      fs.existsSync(path.join(packageDir, 'index.d.ts')),
  );
}

// Test runners providing the `describe`/`it` globals. `null` means the runner
// ships its own types and needs tsconfig wiring rather than an @types install.
const TEST_RUNNER_TYPES: [runner: string, typesPackage: string | null][] = [
  ['jest', '@types/jest'],
  ['vitest', null],
  ['mocha', '@types/mocha'],
  ['jasmine', '@types/jasmine'],
];

// @types packages that declare environment globals rather than typing the
// npm package of the same name; "the library ships its own types" does not
// apply to them.
const GLOBAL_TYPES_PACKAGES = new Set([
  '@types/node',
  '@types/jest',
  '@types/mocha',
  '@types/jasmine',
  '@types/bun',
]);

const MAX_UNTYPED_MODULES = 8;

export interface TypesPackageRecommendation {
  packageName: string;
  errorCount: number;
  fileCount: number;
  exampleNames: string[];
}

export interface TypesPackageReport {
  packageManager: PackageManager;
  /** The version off the `packageManager` pin, when the project has one. */
  packageManagerVersion?: string;
  /** The flag the install needs because its target directory is a workspace root. */
  workspaceRootFlag?: string;
  /** Where to run the install, when that is not the working directory of the run. */
  installDir?: string;
  missing: TypesPackageRecommendation[];
  untyped: TypesPackageRecommendation[];
  notLoaded: { packageName: string; advice: string }[];
  outdated: { packageName: string; installedVersion: string; suggestion: string }[];
  redundant: { packageName: string; libName: string }[];
  notes: string[];
  /** The tsconfig pins a "types" array, so installing a package is not enough to load it. */
  typesPinned?: boolean;
  /** The shorthand declarations the run generated, when it generated any. */
  declared?: ModuleDeclarations;
}

/** The package a specifier belongs to: `lodash/fp` is published as `lodash`. */
function packageNameOf(moduleName: string): string {
  const segments = moduleName.split('/');
  return moduleName.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function typesPackageFor(moduleName: string): string {
  const packageName = packageNameOf(moduleName);
  return packageName.startsWith('@')
    ? `@types/${packageName.slice(1).replace('/', '__')}`
    : `@types/${packageName}`;
}

function libPackageFor(typesName: string): string {
  const rest = typesName.slice('@types/'.length);
  return rest.includes('__') ? `@${rest.replace('__', '/')}` : rest;
}

function exampleNames(names: Set<string>): string[] {
  return Array.from(names).slice(0, 3);
}

/**
 * Imports TS7016 fired on: the specifier resolved to a real JavaScript
 * implementation on disk, so the only thing missing is a declaration. Modules
 * an installed @types package already covers are dropped — the types exist and
 * are merely not being loaded, which no new declaration would fix.
 */
function confirmedUntypedModules(
  evidence: TypesEvidence,
  rootDir: string,
): { moduleName: string; module: ModuleEvidence }[] {
  return Array.from(evidence.untypedModules.entries())
    .map(([moduleName, module]) => ({ moduleName, module }))
    .filter(({ moduleName }) => !findInstalledPackage(rootDir, typesPackageFor(moduleName)))
    .sort((a, b) => b.module.errorCount - a.module.errorCount);
}

export function summarizeTypesEvidence(
  evidence: TypesEvidence,
  rootDir: string,
): TypesPackageReport {
  const nearest = findNearestPackageJson(rootDir);
  // The install lands in the package the migration root belongs to, which is
  // the directory that decides both the workspace flag and the "run from" line.
  const installDir = nearest?.dir ?? rootDir;
  const detected = detectPackageManager(rootDir, installDir);
  const report: TypesPackageReport = {
    packageManager: detected.packageManager,
    packageManagerVersion: detected.version,
    workspaceRootFlag: detected.workspaceRootFlag,
    installDir: installDirLabel(installDir),
    missing: [],
    untyped: [],
    notLoaded: [],
    outdated: [],
    redundant: [],
    notes: [],
    typesPinned: evidence.compilerTypes !== undefined,
  };

  const declaredDeps: { [name: string]: string } = {
    ...nearest?.packageJson.dependencies,
    ...nearest?.packageJson.devDependencies,
  };

  const addEnvRecommendation = (env: EnvEvidence, packageName: string) => {
    const installed = findInstalledPackage(rootDir, packageName);
    if (installed) {
      const typesEntry = packageName.slice('@types/'.length);
      const advice =
        evidence.compilerTypes && !evidence.compilerTypes.includes(typesEntry)
          ? `installed but not in the "types" array in tsconfig.json — add "${typesEntry}"`
          : 'installed but not being loaded — check "types" and "typeRoots" in tsconfig.json';
      report.notLoaded.push({ packageName, advice });
      return;
    }
    report.missing.push({
      packageName,
      errorCount: env.errorCount + env.weakCount,
      fileCount: env.files.size,
      exampleNames: exampleNames(env.names),
    });
  };

  evidence.env.forEach((env, key) => {
    if (env.errorCount === 0) return;

    if (key === 'testRunner') {
      // A runner the project declares names itself. One it does not declare
      // still supplies these globals when a dependency brought it in, which is
      // the shape create-react-app and a hoisting monorepo both leave behind,
      // and the types it needs are the ones worth the most here. Falling back
      // to what resolves is only unambiguous when a single runner does: a
      // project holding two has no evidence here saying which one wrote the
      // tests, and guessing would pin the wrong globals.
      const declared = TEST_RUNNER_TYPES.find(([runner]) => declaredDeps[runner] !== undefined);
      const installed = TEST_RUNNER_TYPES.filter(([runner]) =>
        findInstalledPackage(rootDir, runner),
      );
      const runnerEntry = declared ?? (installed.length === 1 ? installed[0] : undefined);
      if (!runnerEntry) {
        report.notes.push(
          `Test globals (${exampleNames(env.names).join(', ')}) caused ${env.errorCount} ` +
            'error(s), but no test runner was found in package.json — install @types/jest or ' +
            '@types/mocha to match your test runner.',
        );
        return;
      }
      const [runner, typesPackage] = runnerEntry;
      if (typesPackage === null) {
        report.notes.push(
          `Test globals (${exampleNames(env.names).join(', ')}) come from ${runner}: add ` +
            `"${runner}/globals" to the "types" array in tsconfig.json (with globals: true in ` +
            `the ${runner} config), or import them from '${runner}'.`,
        );
        return;
      }
      addEnvRecommendation(env, typesPackage);
      return;
    }

    const packageName = { node: '@types/node', jquery: '@types/jquery', bun: '@types/bun' }[key];
    addEnvRecommendation(env, packageName);
  });

  // Several specifiers can come from one package (`lodash/fp`, `lodash/get`),
  // and one @types package would type them all.
  interface UntypedPackage {
    errorCount: number;
    files: Set<string>;
    names: Set<string>;
  }
  const untypedPackages = new Map<string, UntypedPackage>();
  confirmedUntypedModules(evidence, rootDir).forEach(({ moduleName, module }) => {
    const packageName = typesPackageFor(moduleName);
    const entry: UntypedPackage = untypedPackages.get(packageName) ?? {
      errorCount: 0,
      files: new Set(),
      names: new Set(),
    };
    untypedPackages.set(packageName, entry);
    entry.errorCount += module.errorCount;
    module.files.forEach((file) => entry.files.add(file));
    entry.names.add(`import '${moduleName}'`);
  });
  const untypedRecommendations = Array.from(untypedPackages.entries())
    .map(([packageName, entry]) => ({
      packageName,
      errorCount: entry.errorCount,
      fileCount: entry.files.size,
      exampleNames: exampleNames(entry.names),
    }))
    .sort((a, b) => b.errorCount - a.errorCount);
  report.untyped.push(...untypedRecommendations.slice(0, MAX_UNTYPED_MODULES));
  if (untypedRecommendations.length > MAX_UNTYPED_MODULES) {
    report.notes.push(
      `${untypedRecommendations.length - MAX_UNTYPED_MODULES} more untyped import(s) omitted.`,
    );
  }

  report.missing.sort((a, b) => b.errorCount - a.errorCount);

  Object.keys(declaredDeps)
    .filter((name) => name.startsWith('@types/'))
    .forEach((typesName) => {
      const installedTypes = findInstalledPackage(rootDir, typesName);
      const typesVersion = installedTypes?.packageJson.version;
      const typesMajor = firstMajor(typesVersion);
      if (!installedTypes || !typesVersion || typesMajor === undefined) return;

      if (typesName === '@types/node') {
        const nodeMajor = detectNodeMajor(rootDir, nearest?.packageJson);
        if (nodeMajor !== undefined && nodeMajor > 0 && typesMajor < nodeMajor) {
          report.outdated.push({
            packageName: typesName,
            installedVersion: typesVersion,
            suggestion: `the project targets Node ${nodeMajor}; consider @types/node@${nodeMajor}`,
          });
        }
        return;
      }

      const libName = libPackageFor(typesName);
      const installedLib = findInstalledPackage(rootDir, libName);
      if (!installedLib) return;

      const libVersion = installedLib.packageJson.version;
      const libMajor = firstMajor(libVersion);
      // Definitely Typed majors track the library's major; 0.x conventions
      // are too loose to compare.
      if (
        libVersion &&
        libMajor !== undefined &&
        libMajor > 0 &&
        typesMajor > 0 &&
        typesMajor < libMajor
      ) {
        report.outdated.push({
          packageName: typesName,
          installedVersion: typesVersion,
          suggestion: `${libName}@${libVersion} is installed; consider ${typesName}@${libMajor}`,
        });
      }

      if (
        !GLOBAL_TYPES_PACKAGES.has(typesName) &&
        packageShipsTypes(installedLib.dir, installedLib.packageJson)
      ) {
        report.redundant.push({ packageName: typesName, libName });
      }
    });

  // Only worth saying when an install command is actually being printed.
  if (detected.note && (report.missing.length > 0 || report.untyped.length > 0)) {
    report.notes.push(detected.note);
  }

  return report;
}

/** A type package the project's own dependencies imply, named before anything is checked. */
export interface TypesPackageSuggestion {
  packageName: string;
  reason: string;
}

export interface TypesPackagePreflight {
  /** The install command for the detected package manager, workspace flag included. */
  installCommand: string;
  /** Where to run it, when that is not the working directory of the run. */
  installDir?: string;
  suggested: TypesPackageSuggestion[];
}

/**
 * What package.json and the install layout alone say about missing type
 * packages, for the commands that run before there is a program to take
 * diagnostics from. Weaker than the end of run report, so it stays quiet
 * unless a declared dependency resolves: nothing resolving means the project
 * is not installed, or does not use node_modules, rather than that its type
 * packages are missing.
 */
export function preflightTypesPackages(rootDir: string): TypesPackagePreflight {
  const nearest = findNearestPackageJson(rootDir);
  const installDir = nearest?.dir ?? rootDir;
  const detected = detectPackageManager(rootDir, installDir);
  const preflight: TypesPackagePreflight = {
    installCommand:
      INSTALL_COMMANDS[detected.packageManager] +
      (detected.workspaceRootFlag ? ` ${detected.workspaceRootFlag}` : ''),
    installDir: installDirLabel(installDir),
    suggested: [],
  };

  const declaredDeps: { [name: string]: string } = {
    ...nearest?.packageJson.dependencies,
    ...nearest?.packageJson.devDependencies,
  };
  const resolves = (packageName: string) =>
    findInstalledPackage(rootDir, packageName) !== undefined;
  if (!Object.keys(declaredDeps).some(resolves)) return preflight;

  // A package the project already declares is not missing from it; an install
  // that has not caught up needs the install run, not another dependency.
  const absent = (packageName: string) =>
    declaredDeps[packageName] === undefined && !resolves(packageName);

  if (absent('@types/node')) {
    preflight.suggested.push({
      packageName: '@types/node',
      reason: 'node globals and imports of builtin modules have no types without it',
    });
  }

  const runnerEntry = TEST_RUNNER_TYPES.find(
    ([runner]) => declaredDeps[runner] !== undefined && resolves(runner),
  );
  if (runnerEntry && runnerEntry[1] !== null && absent(runnerEntry[1])) {
    preflight.suggested.push({
      packageName: runnerEntry[1],
      reason: `${runnerEntry[0]} is a dependency here and its test globals have no types without it`,
    });
  }

  return preflight;
}

export function formatTypesPackagePreflight(
  preflight: TypesPackagePreflight,
  typesPinned = false,
): string | null {
  if (preflight.suggested.length === 0) return null;

  const lines = preflight.suggested.map(
    ({ packageName, reason }) => `  ${packageName} is not installed: ${reason}.`,
  );
  const names = preflight.suggested.map(({ packageName }) => packageName).join(' ');
  lines.push(`  Install: ${preflight.installCommand} ${names}`);
  if (preflight.installDir) lines.push(`  Run from: ${preflight.installDir}`);
  if (typesPinned) {
    lines.push(
      '  Then add each one to the "types" array in the project tsconfig.json' +
        ' (drop the "@types/" prefix).',
    );
  }
  lines.push(
    '  Installing them first keeps this migration from suppressing the errors they would fix.',
  );
  return ['Type packages worth installing before the migration:', ...lines].join('\n');
}

const GENERATED_MARKER = '// Generated by ts-migrate.';

const DECLARE_MODULE = /^declare module '([^']+)';$/;

/** Where the generated shorthand module declarations live, relative to the migration root. */
export const MODULE_DECLARATIONS_FILE = 'types/ts-migrate-modules.d.ts';

function moduleDeclarationsPath(rootDir: string): string {
  return path.join(rootDir, ...MODULE_DECLARATIONS_FILE.split('/'));
}

/**
 * The modules a previously generated declaration file declares, or null if the
 * file is not one ts-migrate wrote — a hand-written file at that path is the
 * user's, and overwriting it would lose their declarations.
 */
export function parseModuleDeclarations(text: string): string[] | null {
  if (!text.startsWith(GENERATED_MARKER)) return null;
  return text
    .split('\n')
    .map((line) => DECLARE_MODULE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
}

export function renderModuleDeclarations(moduleNames: string[]): string {
  const declarations = [...new Set(moduleNames)].sort();
  return [
    `${GENERATED_MARKER} Modules whose packages ship no type definitions, declared`,
    '// here so their imports are `any` instead of an error at every import site.',
    '// Install the types when a package has them and delete its line; ts-migrate',
    '// drops entries whose types it can resolve the next time it runs.',
    ...(declarations.length === 0
      ? ['// Every module this file declared now has types. Safe to delete.']
      : declarations.map((moduleName) => `declare module '${moduleName}';`)),
    '',
  ].join('\n');
}

/**
 * Whether the specifier's package now has type definitions, making its
 * declaration stale. A shorthand declaration shadows the real types, so the
 * stale entry has to go or the package stays `any` forever.
 *
 * The whole package counts, subpaths included: a subpath the installed types
 * turn out not to cover goes back to being a suppressed import, which is the
 * visible failure. Keeping the declaration would be the silent one.
 */
function moduleHasTypes(rootDir: string, moduleName: string): boolean {
  if (findInstalledPackage(rootDir, typesPackageFor(moduleName))) return true;
  const installed = findInstalledPackage(rootDir, packageNameOf(moduleName));
  return installed ? packageShipsTypes(installed.dir, installed.packageJson) : false;
}

export interface ModuleDeclarations {
  filePath: string;
  text: string;
  moduleNames: string[];
}

/**
 * Builds the declaration file for every module with no types available: the
 * ones this run found, plus the ones an earlier run declared and that still
 * have no types. Once every entry has types the file is emptied rather than
 * left alone, since its declarations would shadow the types that replaced them.
 *
 * Returns null when there is nothing to declare and no file to clear, or when
 * a file ts-migrate did not write already sits at that path.
 */
export function buildModuleDeclarations(
  evidence: TypesEvidence,
  rootDir: string,
): ModuleDeclarations | null {
  const filePath = moduleDeclarationsPath(rootDir);
  let existingText: string | undefined;
  try {
    existingText = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // No declaration file yet.
  }
  const previous = existingText === undefined ? [] : parseModuleDeclarations(existingText);
  if (previous === null) return null;

  const found = confirmedUntypedModules(evidence, rootDir).map(({ moduleName }) => moduleName);
  const moduleNames = [...new Set([...previous, ...found])]
    .filter((moduleName) => !moduleHasTypes(rootDir, moduleName))
    .sort();
  if (moduleNames.length === 0 && previous.length === 0) return null;

  return { filePath, text: renderModuleDeclarations(moduleNames), moduleNames };
}

export interface TypesPackageDetector {
  plugin: Plugin<unknown>;
  /**
   * Writes the shorthand declarations for the modules `plugin` found with no
   * types available. Add it to the pipeline between that plugin and ts-ignore:
   * the evidence is complete once a pass ends, and the declarations have to
   * reach the program before ts-ignore suppresses the errors they resolve.
   */
  declarationsPlugin: Plugin<unknown>;
  summarize(rootDir: string): TypesPackageReport;
}

/**
 * Creates a read-only plugin that classifies each file's semantic diagnostics
 * into @types package recommendations, and a `summarize` to build the report
 * once the run finishes. Run it immediately before ts-ignore: suppression
 * comments hide the diagnostics it reads, and sharing ts-ignore's warm program
 * means the per-file diagnostics are only computed once.
 */
export function createTypesPackageDetector(): TypesPackageDetector {
  const evidence = createTypesEvidence();

  const plugin: Plugin<unknown> = {
    name: 'detect-types-packages',
    mutationsPreserveTypes: true,
    run({ fileName, getLanguageService }) {
      const languageService = getLanguageService();
      if (!evidence.compilerTypesCaptured) {
        evidence.compilerTypes = languageService.getProgram?.()?.getCompilerOptions().types;
        evidence.compilerTypesCaptured = true;
      }
      collectTypesEvidence(evidence, fileName, languageService.getSemanticDiagnostics(fileName));
      return undefined;
    },
  };

  let declared: ModuleDeclarations | null = null;
  let declarationsRun = false;
  const declarationsPlugin: Plugin<unknown> = {
    name: 'declare-untyped-modules',
    run({ rootDir, addGeneratedFile }) {
      // One file's worth of work for the whole run: the evidence covers every
      // file already, and generating the declarations again per file would
      // invalidate the program each time.
      if (declarationsRun) return undefined;
      declarationsRun = true;
      if (!addGeneratedFile) return undefined;
      declared = buildModuleDeclarations(evidence, rootDir);
      if (declared) addGeneratedFile(declared.filePath, declared.text);
      return undefined;
    },
  };

  return {
    plugin,
    declarationsPlugin,
    summarize: (rootDir: string) => {
      const report = summarizeTypesEvidence(evidence, rootDir);
      report.declared = declared ?? undefined;
      return report;
    },
  };
}

export function formatTypesPackageReport(
  report: TypesPackageReport,
  folder = '<folder>',
): string | null {
  const lines: string[] = [];
  const recommendationLine = (rec: TypesPackageRecommendation) => {
    const names = rec.exampleNames.length ? ` (${rec.exampleNames.join(', ')})` : '';
    return `    ${rec.packageName} — ${pluralize(rec.errorCount, 'error')} in ${pluralize(
      rec.fileCount,
      'file',
    )}${names}`;
  };

  if (report.missing.length > 0) {
    lines.push('  Missing type definitions:');
    report.missing.forEach((rec) => lines.push(recommendationLine(rec)));
  }
  if (report.untyped.length > 0) {
    lines.push('  Untyped imports (@types packages may exist for them):');
    report.untyped.forEach((rec) => lines.push(recommendationLine(rec)));
  }

  const install =
    INSTALL_COMMANDS[report.packageManager] +
    (report.workspaceRootFlag ? ` ${report.workspaceRootFlag}` : '');
  if (report.missing.length > 0) {
    lines.push(`  Install: ${install} ${report.missing.map((rec) => rec.packageName).join(' ')}`);
  }
  if (report.untyped.length > 0) {
    const verb = report.missing.length > 0 ? 'Then try' : 'Try';
    lines.push(`  ${verb}: ${install} ${report.untyped.map((rec) => rec.packageName).join(' ')}`);
  }
  if (report.installDir && (report.missing.length > 0 || report.untyped.length > 0)) {
    lines.push(`  Run from: ${report.installDir}`);
  }
  const declaredCount = report.declared?.moduleNames.length;
  if (declaredCount) {
    lines.push(
      `  ${pluralize(declaredCount, 'module')} with no types available ` +
        `${declaredCount === 1 ? 'is' : 'are'} declared in ` +
        `${MODULE_DECLARATIONS_FILE}, so their imports are \`any\` rather than a suppression at ` +
        'every import site. Delete a module from that file once its types are installed.',
    );
  } else if (report.declared) {
    lines.push(
      `  Every module ${MODULE_DECLARATIONS_FILE} declared now has types, so the file is empty ` +
        'and can be deleted.',
    );
  }
  if (report.typesPinned && (report.missing.length > 0 || report.untyped.length > 0)) {
    lines.push(
      '  Then add each installed package to the "types" array in tsconfig.json' +
        ' (drop the "@types/" prefix).',
    );
  }

  if (report.notLoaded.length > 0) {
    lines.push('  Installed but not loaded:');
    report.notLoaded.forEach(({ packageName, advice }) => {
      lines.push(`    ${packageName} — ${advice}`);
    });
  }
  if (report.outdated.length > 0) {
    lines.push('  Possibly outdated type definitions:');
    report.outdated.forEach(({ packageName, installedVersion, suggestion }) => {
      lines.push(`    ${packageName}@${installedVersion} — ${suggestion}`);
    });
  }
  if (report.redundant.length > 0) {
    lines.push('  Possibly redundant (the library ships its own types):');
    report.redundant.forEach(({ packageName, libName }) => {
      lines.push(`    ${packageName} — ${libName} bundles its own type definitions`);
    });
  }
  report.notes.forEach((note) => lines.push(`  Note: ${note}`));

  if (report.missing.length > 0 || report.untyped.length > 0 || report.notLoaded.length > 0) {
    lines.push(
      '  After installing type definitions, rerun: ' +
        `npx -p @obiemunoz/ts-migrate ts-migrate reignore ${folder}`,
    );
  }

  if (lines.length === 0) return null;
  return ['Type definition recommendations:', ...lines].join('\n');
}
