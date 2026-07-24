import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';

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

function findUp<T>(startDir: string, probe: (dir: string) => T | undefined): T | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const result = probe(dir);
    if (result !== undefined) return result;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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

function detectPackageManager(startDir: string): PackageManager {
  const found = findUp(startDir, (dir) => {
    const entry = LOCKFILES.find(([file]) => fs.existsSync(path.join(dir, file)));
    return entry ? entry[1] : undefined;
  });
  return found ?? 'npm';
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
  const report: TypesPackageReport = {
    packageManager: detectPackageManager(rootDir),
    missing: [],
    untyped: [],
    notLoaded: [],
    outdated: [],
    redundant: [],
    notes: [],
    typesPinned: evidence.compilerTypes !== undefined,
  };

  const nearest = findNearestPackageJson(rootDir);
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
      const runnerEntry = TEST_RUNNER_TYPES.find(([runner]) => declaredDeps[runner] !== undefined);
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

  return report;
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

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
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

  const install = INSTALL_COMMANDS[report.packageManager];
  if (report.missing.length > 0) {
    lines.push(`  Install: ${install} ${report.missing.map((rec) => rec.packageName).join(' ')}`);
  }
  if (report.untyped.length > 0) {
    const verb = report.missing.length > 0 ? 'Then try' : 'Try';
    lines.push(`  ${verb}: ${install} ${report.untyped.map((rec) => rec.packageName).join(' ')}`);
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
