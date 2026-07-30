import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import type { loadESLint } from 'eslint';
import log from 'updatable-log';
import {
  errorMessage,
  fileNoticeReporter,
  Plugin,
  PluginFileNotice,
} from '@obiemunoz/ts-migrate-server';
import { readPackageVersion, resolvePackageFrom } from '../utils/resolvePackageFrom';
import { createValidate, Properties } from '../utils/validateOptions';

// Either the flat-config or legacy engine; both expose the `lintText` API.
type AnyESLint = InstanceType<Awaited<ReturnType<typeof loadESLint>>>;

export type Options = {
  /**
   * Lint with the project's own ESLint when one is installed and usable
   * (default). False pins the copy bundled with ts-migrate.
   */
  projectEslint?: boolean;
};

const optionProperties: Properties = {
  projectEslint: { type: 'boolean' },
};

// Flat config file names, in ESLint's resolution order.
const FLAT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

// The flat config (`eslint.config.*`) discoverable from `dir` upward, if any.
// ESLint 9 always defaults to flat config, so we detect it to fall back to the
// legacy `.eslintrc` engine when absent.
function findFlatConfig(dir: string): string | undefined {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    const found = FLAT_CONFIG_FILENAMES.map((name) => path.join(current, name)).find((file) =>
      fs.existsSync(file),
    );
    if (found) return found;
    if (path.dirname(current) === current) return undefined;
  }
}

/** Which config governs the run, and where the engine resolves it from. */
interface ESLintConfigChoice {
  useFlatConfig: boolean;
  /** The flat config discovery found, when it found one. */
  configFile?: string;
  /** What the engine is given as its `cwd`: the project being migrated. */
  cwd: string;
  /** Set when ESLINT_USE_FLAT_CONFIG decided rather than discovery. */
  fromEnv: boolean;
}

/**
 * The migration root is the project, and `process.cwd()` need not be inside it
 * (`ts-migrate migrate packages/app` from a repository root). Discovery walks
 * up from the root, and so does the engine's own flat config lookup, since the
 * engine is rooted there: one search, so the config the banner names is the
 * config that lints. A config reachable only from the working directory is
 * some other project's, and an engine rooted at the migration root would never
 * load it.
 */
function resolveESLintConfig(rootDir: string): ESLintConfigChoice {
  const cwd = path.resolve(rootDir);
  const configFile = findFlatConfig(cwd);
  const override = process.env.ESLINT_USE_FLAT_CONFIG;
  return {
    useFlatConfig: override != null ? override !== 'false' : configFile != null,
    configFile,
    cwd,
    fromEnv: override != null,
  };
}

/**
 * Which ESLint lints. The project's config was written for the project's own
 * engine, and rule semantics, config resolution, and severity defaults all
 * move between majors: a rule written against the ESLint 8 context API
 * (`context.getScope()` and friends, removed in 9) throws for every file when
 * a bundled ESLint 9 runs it, and eslint-fix can only report that and hand
 * the file back unfixed. So the project's copy is preferred, the same way the
 * compiler is (see ts-migrate's utils/resolveTypeScript).
 */
interface ESLintEngine {
  /** What gets required: a package directory, or ts-migrate's own entry. */
  entryPath: string;
  version: string;
  source: 'project' | 'bundled';
  module: ESLintModule;
  /** Decided once, so every worker lints with the same engine and config. */
  config: ESLintConfigChoice;
  /**
   * A project copy that was found and not used. The reason is a verb phrase
   * about that copy, so it reads after both "eslint 7.32.0, which ..." and
   * "This project's eslint 7.32.0 ...".
   */
  refused?: { version: string; reason: string };
  /** The bundled engine was asked for by name, so nothing is a compromise. */
  optedOut?: boolean;
}

type ESLintConstructor = new (options: {
  fix: boolean;
  ignore: boolean;
  cwd: string;
}) => AnyESLint;

interface ESLintModule {
  /** 8.57 and later. Chooses the flat-config or the eslintrc engine. */
  loadESLint?: (options: { useFlatConfig: boolean }) => Promise<ESLintConstructor>;
  /** 8.0 and later. The eslintrc engine; flat config is behind internals. */
  ESLint?: ESLintConstructor;
}

// Below this the export shape predates the `ESLint` class entirely, and the
// rule and config APIs are far enough from what this plugin drives that the
// bundled engine is the safer answer.
const MIN_PROJECT_MAJOR = 8;

/** The ESLint installed alongside ts-migrate, used when the project's is not. */
function findBundledESLint(): { entryPath: string; version: string } {
  const entryPath = require.resolve('eslint');
  for (let dir = path.dirname(entryPath); ; dir = path.dirname(dir)) {
    const version = readPackageVersion(dir, 'eslint');
    if (version) return { entryPath, version };
    if (path.dirname(dir) === dir) return { entryPath, version: 'unknown version' };
  }
}

// Flat config file names ESLint can only read through jiti, which it declares
// as an optional peer dependency: a project that installed eslint on its own
// need not have one.
const TYPESCRIPT_CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts'];

/**
 * Whether the ESLint at `packageDir` can load a TypeScript flat config. ESLint
 * imports jiti from its own location, so the copy that decides this is the one
 * resolvable from there, and the location it resolves from is the realpath:
 * under pnpm that is the store directory whose siblings are the peers the
 * install chose, not the link in the project's node_modules. ts-migrate's own
 * ESLint always passes, since this package depends on jiti.
 */
function canLoadTypeScriptConfig(packageDir: string): boolean {
  let from = packageDir;
  try {
    from = fs.realpathSync(packageDir);
  } catch {
    // Not a link, or gone since it was found; the path as given still walks.
  }
  return resolvePackageFrom(from, 'jiti') !== undefined;
}

function resolveESLintEngine(
  rootDir: string,
  useProjectESLint: boolean,
  config: ESLintConfigChoice,
): ESLintEngine {
  const bundled = findBundledESLint();
  const useBundled = (extra: Partial<ESLintEngine> = {}): ESLintEngine => ({
    ...bundled,
    source: 'bundled',
    module: require(bundled.entryPath),
    config,
    ...extra,
  });

  if (!useProjectESLint) return useBundled({ optedOut: true });

  // The ESLint the project's own `eslint` would run, found the way the project
  // would find it rather than the way this process resolves modules.
  const project = resolvePackageFrom(rootDir, 'eslint');
  if (!project) return useBundled();

  const refuse = (reason: string) => useBundled({ refused: { version: project.version, reason } });

  const major = Number.parseInt(project.version, 10);
  if (!Number.isInteger(major) || major < MIN_PROJECT_MAJOR) {
    return refuse(`is below the ESLint ${MIN_PROJECT_MAJOR} floor ts-migrate can load`);
  }

  let projectModule: ESLintModule;
  try {
    projectModule = require(project.packageDir);
  } catch (error) {
    return refuse(`could not be loaded (${errorMessage(error)})`);
  }

  if (typeof projectModule.loadESLint !== 'function') {
    if (typeof projectModule.ESLint !== 'function') {
      return refuse('exports neither loadESLint nor an ESLint class');
    }
    if (config.useFlatConfig) {
      // 8.0 through 8.56 reach flat config only through
      // eslint/use-at-your-own-risk, which is not an API to hold a migration to.
      return refuse('predates flat config support in the ESLint public API (8.57)');
    }
  }

  // Without this the config throws inside lintText, once per file, and the
  // only thing the run says is that every file failed.
  if (
    config.useFlatConfig &&
    config.configFile != null &&
    TYPESCRIPT_CONFIG_EXTENSIONS.includes(path.extname(config.configFile)) &&
    !canLoadTypeScriptConfig(project.packageDir)
  ) {
    return refuse('cannot load a TypeScript config without jiti installed');
  }

  return {
    entryPath: project.packageDir,
    version: project.version,
    source: 'project',
    module: projectModule,
    config,
  };
}

/** The run banner: which engine lints, and why it was that one. */
function describeESLintEngine(engine: ESLintEngine): string {
  if (engine.source === 'project') {
    return `[eslint-fix] ESLint ${engine.version} (project: ${engine.entryPath})`;
  }
  let why = 'project has no eslint installed';
  if (engine.optedOut) {
    why = '--projectEslint=false';
  } else if (engine.refused) {
    why = `project has eslint ${engine.refused.version}, which ${engine.refused.reason}`;
  }
  return `[eslint-fix] ESLint ${engine.version} (bundled with ts-migrate; ${why})`;
}

/**
 * The second banner line: which config lints. Without it nothing in the output
 * separates "no rule matched these files" from "the config was never found",
 * and the latter is silent because each file's throw is caught per file.
 */
function describeESLintConfig({
  useFlatConfig,
  configFile,
  cwd,
  fromEnv,
}: ESLintConfigChoice): string {
  const why = fromEnv ? ' [ESLINT_USE_FLAT_CONFIG]' : '';
  if (!useFlatConfig) {
    // The eslintrc engine resolves a config per file, so there is no one file
    // to name; where it is rooted is the useful half.
    const found = fromEnv ? '' : ' (no eslint.config.* found from there)';
    return `[eslint-fix] eslintrc config, rooted at ${cwd}${why}${found}`;
  }
  return `[eslint-fix] flat config: ${configFile ?? `none found from ${cwd}`}${why}`;
}

// Lazily create one ESLint instance, shared across all files in a run.
// (`jiti`, a dependency, is what lets ESLint load a TypeScript `eslint.config.ts`.)
let eslintPromise: Promise<AnyESLint> | undefined;
// Set with it, and read when spawning workers so they load the same engine.
let resolvedEngine: ESLintEngine | undefined;

async function createESLint(rootDir: string, useProjectESLint: boolean): Promise<AnyESLint> {
  const config = resolveESLintConfig(rootDir);
  const engine = resolveESLintEngine(rootDir, useProjectESLint, config);
  resolvedEngine = engine;

  // Through updatable-log, not console: it clears the pass's in-place counter
  // before it writes, and the counter erases whatever sits in its region on the
  // next render.
  log.info(describeESLintEngine(engine));
  log.info(describeESLintConfig(config));
  if (engine.refused) {
    log.warn(
      `[eslint-fix] This project's eslint ${engine.refused.version} ${engine.refused.reason}; ` +
        `linting with the ESLint ${engine.version} bundled with ts-migrate instead. Rules and ` +
        'plugins pinned to the project ESLint can fail under it, and files whose rules throw ' +
        'come back unfixed.',
    );
  }

  return instantiateESLint(engine, {
    fix: true,
    // Set ignore to false so we can lint in `tmp` for testing.
    ignore: false,
    // Flat config lookup, ignore file lookup, and relative paths inside the
    // config all start here, so it has to be the project, not wherever the
    // command was typed.
    cwd: config.cwd,
  });
}

/** Enters the engine through whichever of the two APIs it exports. */
async function instantiateESLint(
  engine: ESLintEngine,
  options: { fix: boolean; ignore: boolean; cwd: string },
): Promise<AnyESLint> {
  if (typeof engine.module.loadESLint === 'function') {
    const ESLintClass = await engine.module.loadESLint({
      useFlatConfig: engine.config.useFlatConfig,
    });
    return new ESLintClass(options);
  }
  return new (engine.module.ESLint as ESLintConstructor)(options);
}

function getESLint(rootDir: string, useProjectESLint: boolean): Promise<AnyESLint> {
  if (!eslintPromise) {
    eslintPromise = createESLint(rootDir, useProjectESLint);
  }
  return eslintPromise;
}

/** A generated declaration file the project's ESLint reports a parse error on. */
export interface GeneratedFileParseError {
  filePath: string;
  /** ESLint's own message, e.g. `Parsing error: Unexpected token global`. */
  message: string;
}

/**
 * Which of the declaration files a run generates the project's ESLint cannot
 * read. They hold nothing but TypeScript, so a config that routes them to a
 * parser for JavaScript stops at the first declaration keyword: the compiler is
 * satisfied and `eslint .` is not. Worth a report of its own rather than a
 * comment in the generated file, since a parse error is fatal and no directive
 * comment suppresses one.
 *
 * The check runs on the engine an eslint-fix pass already resolved, and reports
 * nothing when no pass did. Resolving one here would put its banner lines after
 * everything else the run has to say, and would lint on behalf of a project
 * that had opted out of linting during the migration.
 *
 * Ignores are honoured, which the fixing instance disables: ignoring these
 * files is one of the two answers to a config that cannot parse them, and a run
 * that reported a file the project had ignored would ask for the same edit
 * forever.
 */
export async function findGeneratedFileParseErrors(
  files: Iterable<{ filePath: string; text: string }>,
): Promise<GeneratedFileParseError[]> {
  const engine = resolvedEngine;
  const candidates = [...files];
  if (!engine || candidates.length === 0) return [];

  let cli: AnyESLint;
  try {
    cli = await instantiateESLint(engine, { fix: false, ignore: true, cwd: engine.config.cwd });
  } catch {
    // A config this engine cannot load at all is the pass's finding to report,
    // and it has: every file it linted failed on the same config.
    return [];
  }

  const problems: GeneratedFileParseError[] = [];
  for (const { filePath, text } of candidates) {
    try {
      // One at a time, as the in-process lint route does: lintText on a shared
      // instance is not known to be re-entrant under a type-aware parser.
      const [report] = await cli.lintText(text, { filePath, warnIgnored: false });
      const fatal = report?.messages?.find((message) => message.fatal);
      if (fatal) problems.push({ filePath, message: fatal.message });
    } catch {
      // Per file, for the same reason.
    }
  }
  return problems;
}

// The exact text eslint-fix last produced for each file. eslint's autofix is
// idempotent, so a file whose text is unchanged since then is already at a
// fixed point and re-linting it is a guaranteed no-op. This lets the second
// eslint-fix pass (which runs after ts-ignore) skip every file ts-ignore left
// untouched instead of re-linting the whole project.
const lastFixedText = new Map<string, string>();

type ReportNotice = (notice: PluginFileNotice) => void;

// A project whose ESLint parser is not TypeScript-aware fails this way for
// every file it sees, so the cause is reported and the runner counts the files.
function reportParseError(reportNotice: ReportNotice, message: string): void {
  reportNotice({
    reason: `ESLint could not parse the file (${message})`,
    hint:
      'Lint fixes are skipped for files ESLint cannot parse. If these are TypeScript ' +
      'files, the project ESLint config likely needs the @typescript-eslint parser.',
  });
}

// ESLint applies fixes in rounds of its own and stops after ten, so text that
// is still changing is handed back for another round rather than being at a
// fixed point. Rules whose fixes undo each other never reach one: the text
// cycles, and the round it stops on is wherever ESLint's tenth pass landed.
// Ten rounds is a hundred of ESLint's own passes, far past what a config that
// converges at all needs.
const MAX_FIX_ROUNDS = 10;

// Two shapes of config that never settle, and neither is this file's to
// resolve: the text repeats (rules fixing each other's fixes) or it keeps
// changing for longer than any converging config would.
function reportUnsettledFixes(reportNotice: ReportNotice): void {
  reportNotice({
    reason: `ESLint's fixes for this file never settled (its text was still changing after ${MAX_FIX_ROUNDS} rounds of fixing)`,
    hint:
      'Rules whose fixes undo one another cycle forever, so the file is left unchanged rather ' +
      'than saved at whichever point the cycle was cut. Running the project\'s own ' +
      '`eslint --fix` on the file reports the rules that disagree.',
  });
}

async function fixToStable(
  cli: AnyESLint,
  fileName: string,
  text: string,
  reportNotice: ReportNotice,
): Promise<string> {
  let newText = text;
  const seen = new Set([text]);
  for (let round = 0; round < MAX_FIX_ROUNDS; round += 1) {
    const [report] = await cli.lintText(newText, {
      filePath: fileName,
    });

    const fatalMessage = report?.messages?.find((message) => message.fatal);
    if (fatalMessage) {
      reportParseError(reportNotice, fatalMessage.message);
    }

    if (!report || !report.output || report.output === newText) {
      return newText;
    }
    // Text this file has already been through is a cycle, and every round
    // after it repeats the same states.
    if (seen.has(report.output)) break;
    seen.add(report.output);
    newText = report.output;
  }
  reportUnsettledFixes(reportNotice);
  return text;
}

// Linting is synchronous CPU work inside ESLint, so overlapping lintText calls
// on the main thread gains nothing; real overlap needs worker threads. Each
// worker loads its own ESLint instance once and then fixes files sent to it.
const envPoolSize = (() => {
  const env = process.env.TS_MIGRATE_ESLINT_FIX_WORKERS;
  if (env == null || env === '') return undefined;
  const parsed = Math.floor(Number(env));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

const poolSize =
  envPoolSize ??
  (() => {
    const cores = os.availableParallelism();
    return cores > 2 ? Math.min(cores - 1, 8) : 0;
  })();

// The compiler this process runs, as a package directory. The CLI redirects
// `require('typescript')` at the project's own copy (see ts-migrate's
// utils/resolveTypeScript), and a worker starts with a fresh module registry
// that knows nothing of it. Type-aware configs never reach a worker, but the
// lint rules and import resolvers that do can still load a compiler.
function typeScriptPackageDir(): string | undefined {
  try {
    for (let dir = path.dirname(require.resolve('typescript')); ; dir = path.dirname(dir)) {
      const packageJsonPath = path.join(dir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const { name } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return name === 'typescript' ? dir : undefined;
      }
      if (path.dirname(dir) === dir) return undefined;
    }
  } catch {
    return undefined;
  }
}

// The worker body is inlined so it survives every way this plugin is loaded
// (compiled dist, ts-jest, and the transpile-to-temp-dir test harness). It is
// evaluated on its own, so it can reach nothing from this module's scope: only
// require and workerData. Keep its lint loop in sync with fixToStable above.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');

// Whatever loads a compiler in here gets the one the rest of the migration
// reasons with.
if (workerData.typeScriptDir) {
  const Module = require('module');
  const nodePath = require('path');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'typescript' || request.startsWith('typescript/')) {
      const target = request === 'typescript'
        ? workerData.typeScriptDir
        : nodePath.join(workerData.typeScriptDir, request.slice('typescript/'.length));
      try {
        return originalResolveFilename.call(this, target, ...rest);
      } catch {
        // Not in this copy; fall through to the default resolution.
      }
    }
    return originalResolveFilename.call(this, request, ...rest);
  };
}

// The engine the main thread resolved, entered through the API it chose.
const eslintModule = require(workerData.eslintPath);

let cliPromise;
function getCli() {
  if (!cliPromise) {
    const options = { fix: true, ignore: false, cwd: workerData.cwd };
    cliPromise = workerData.useLoadESLint
      ? eslintModule
          .loadESLint({ useFlatConfig: workerData.useFlatConfig })
          .then((ESLintClass) => new ESLintClass(options))
      : Promise.resolve(new eslintModule.ESLint(options));
  }
  return cliPromise;
}

parentPort.on('message', async ({ fileName, text }) => {
  try {
    const cli = await getCli();
    let newText = text;
    let fatalMessage;
    let settled = false;
    const seen = new Set([text]);
    for (let round = 0; round < workerData.maxFixRounds; round += 1) {
      const [report] = await cli.lintText(newText, { filePath: fileName });
      const fatal = report && report.messages && report.messages.find((m) => m.fatal);
      if (fatal && fatalMessage === undefined) fatalMessage = fatal.message;
      if (!report || !report.output || report.output === newText) { settled = true; break; }
      if (seen.has(report.output)) break;
      seen.add(report.output);
      newText = report.output;
    }
    // An unsettled file is handed back as it arrived; the reporting lives on
    // the main thread, with the in-process route's.
    parentPort.postMessage({
      ok: true,
      text: settled ? newText : text,
      fatalMessage,
      unsettled: !settled,
    });
  } catch (error) {
    // ESLint hangs the failing rule's id on the error it throws; only the
    // message survives the structured clone, so send it alongside.
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ruleId: error && typeof error.ruleId === 'string' ? error.ruleId : undefined,
    });
  }
});
`;

type WorkerResult =
  | { ok: true; text: string; fatalMessage?: string; unsettled?: boolean }
  | { ok: false; error: string; ruleId?: string };

interface PoolJob {
  fileName: string;
  text: string;
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
}

let poolBroken = false;
const workers: Worker[] = [];
const idleWorkers: Worker[] = [];
const queuedJobs: PoolJob[] = [];
const inFlight = new Map<Worker, PoolJob>();

function assignJob(worker: Worker, job: PoolJob): void {
  inFlight.set(worker, job);
  // An in-flight job must keep the process alive; an idle worker must not.
  worker.ref();
  worker.postMessage({ fileName: job.fileName, text: job.text });
}

function releaseWorker(worker: Worker): void {
  if (poolBroken) return;
  const nextJob = queuedJobs.shift();
  if (nextJob) {
    assignJob(worker, nextJob);
  } else {
    idleWorkers.push(worker);
    worker.unref();
  }
}

function failPool(error: Error): void {
  poolBroken = true;
  const failedJobs = [...inFlight.values(), ...queuedJobs];
  inFlight.clear();
  queuedJobs.length = 0;
  workers.forEach((worker) => void worker.terminate());
  workers.length = 0;
  idleWorkers.length = 0;
  failedJobs.forEach((job) => job.reject(error));
}

function spawnWorker(): Worker {
  // A job only reaches the pool after getESLint resolved, so the engine and
  // config the main thread lints with are what workers are handed. A worker
  // that resolved a different config would make a file's fix depend on which
  // route it took.
  if (!resolvedEngine) {
    throw new Error('eslint-fix: no ESLint engine has been resolved yet');
  }
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      eslintPath: resolvedEngine.entryPath,
      useLoadESLint: typeof resolvedEngine.module.loadESLint === 'function',
      typeScriptDir: typeScriptPackageDir(),
      useFlatConfig: resolvedEngine.config.useFlatConfig,
      cwd: resolvedEngine.config.cwd,
      maxFixRounds: MAX_FIX_ROUNDS,
    },
  });
  worker.on('message', (result: WorkerResult) => {
    const job = inFlight.get(worker);
    inFlight.delete(worker);
    job?.resolve(result);
    releaseWorker(worker);
  });
  worker.on('error', (error) => failPool(error));
  worker.on('exit', (code) => {
    if (workers.includes(worker)) {
      failPool(new Error(`eslint worker exited unexpectedly with code ${code}`));
    }
  });
  worker.unref();
  workers.push(worker);
  return worker;
}

function runJobInPool(fileName: string, text: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const job: PoolJob = { fileName, text, resolve, reject };
    if (poolBroken) {
      reject(new Error('eslint worker pool unavailable'));
      return;
    }
    try {
      const worker =
        idleWorkers.pop() ?? (workers.length < poolSize ? spawnWorker() : undefined);
      if (worker) {
        assignJob(worker, job);
      } else {
        queuedJobs.push(job);
      }
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      failPool(spawnError);
      reject(spawnError);
    }
  });
}

// A type-aware config makes every ESLint instance build TypeScript programs;
// one per worker would multiply that memory and setup cost by the pool size,
// so those configs always lint in-process.
function isTypeAwareConfig(config: {
  parserOptions?: Record<string, unknown>;
  languageOptions?: { parserOptions?: Record<string, unknown> };
}): boolean {
  const parserOptions = config?.languageOptions?.parserOptions ?? config?.parserOptions;
  if (!parserOptions) return false;
  return Boolean(
    parserOptions.project ||
      parserOptions.projectService ||
      parserOptions.EXPERIMENTAL_useProjectService ||
      parserOptions.programs,
  );
}

async function shouldLintInWorker(cli: AnyESLint, fileName: string): Promise<boolean> {
  if (poolSize === 0 || poolBroken) return false;
  if (typeof cli.calculateConfigForFile !== 'function') return false;
  try {
    const config = await cli.calculateConfigForFile(fileName);
    return config != null && !isTypeAwareConfig(config);
  } catch {
    return false;
  }
}

// Workers each pay an ESLint + config (and often typescript) load before
// their first file, so a pool only wins once the lint work left to do
// outweighs that spin-up. With no explicit worker count, files lint
// in-process while their per-file cost is measured, and the pool starts only
// when cost x backlog says it will repay itself. An explicit
// TS_MIGRATE_ESLINT_FIX_WORKERS count skips the measuring.
const POOL_CALIBRATION_SAMPLES = 8;
const POOL_WORTHWHILE_MS = 2000;

let serialLintsSeen = 0;
let serialSampleCount = 0;
let serialSampleMsTotal = 0;
let pendingLintCalls = 0;
let poolEnabled = envPoolSize != null && envPoolSize > 0;

function shouldEnablePool(): boolean {
  if (poolSize === 0) return false;
  if (poolEnabled) return true;
  if (envPoolSize != null) return false;
  if (serialSampleCount < POOL_CALIBRATION_SAMPLES) return false;
  const averageMs = serialSampleMsTotal / serialSampleCount;
  const backlog = pendingLintCalls - 1;
  if (backlog * averageMs > POOL_WORTHWHILE_MS) {
    poolEnabled = true;
  }
  return poolEnabled;
}

async function routeToPool(cli: AnyESLint, fileName: string): Promise<boolean> {
  return shouldEnablePool() && shouldLintInWorker(cli, fileName);
}

/** A lint failure carries the id of the rule that threw; a pooled one too. */
class LintError extends Error {
  readonly ruleId?: string;

  constructor(message: string, ruleId?: string) {
    super(message);
    this.ruleId = ruleId;
  }
}

// Returns undefined when the pool infrastructure failed (the file still needs
// linting in-process); lint-level errors throw, as they do in-process.
async function tryPool(
  fileName: string,
  text: string,
  reportNotice: ReportNotice,
): Promise<string | undefined> {
  let result: WorkerResult;
  try {
    result = await runJobInPool(fileName, text);
  } catch (poolError) {
    const message = errorMessage(poolError);
    reportNotice({
      reason: `lint workers unavailable (${message}); linted in-process`,
      recovered: true,
    });
    return undefined;
  }
  if (!result.ok) {
    throw new LintError(result.error, result.ruleId);
  }
  if (result.fatalMessage !== undefined) {
    reportParseError(reportNotice, result.fatalMessage);
  }
  if (result.unsettled) {
    reportUnsettledFixes(reportNotice);
  }
  return result.text;
}

// The runner keeps every file's run() in flight at once, but in-process lint
// calls still go one at a time: overlap gains nothing on one thread, and it
// would make lintText re-entrant on the shared instance (untested territory
// for type-aware parsers). Each queued file re-decides its route when its
// turn comes, so once calibration proves the pool worthwhile the rest of the
// backlog hands off to it mid-pass.
let inProcessChain: Promise<unknown> = Promise.resolve();

async function lintFile(
  cli: AnyESLint,
  fileName: string,
  text: string,
  reportNotice: ReportNotice,
): Promise<string> {
  if (await routeToPool(cli, fileName)) {
    const pooled = await tryPool(fileName, text, reportNotice);
    if (pooled !== undefined) return pooled;
    // Pool broke; take the in-process route below (the gate is now off).
  }
  const outcome = inProcessChain.then(async (): Promise<{ handoff: boolean; fixed?: string }> => {
    if (await routeToPool(cli, fileName)) {
      return { handoff: true };
    }
    const started = Date.now();
    const fixed = await fixToStable(cli, fileName, text, reportNotice);
    serialLintsSeen += 1;
    // The first in-process lint pays the one-time engine + config load and
    // would skew the per-file average.
    if (serialLintsSeen > 1) {
      serialSampleCount += 1;
      serialSampleMsTotal += Date.now() - started;
    }
    return { handoff: false, fixed };
  });
  inProcessChain = outcome.catch(() => undefined);
  const result = await outcome;
  if (result.handoff) {
    return lintFile(cli, fileName, text, reportNotice);
  }
  return result.fixed as string;
}

// Rule context methods ESLint 9 removed. A rule written against the ESLint 8
// context throws one of these for every file it is asked to lint.
const REMOVED_CONTEXT_METHODS = [
  'getScope',
  'getDeclaredVariables',
  'getAncestors',
  'markVariableAsUsed',
  'getSourceCode',
  'getFilename',
  'getPhysicalFilename',
];

function removedContextApiHint(reason: string): string | undefined {
  const removed = REMOVED_CONTEXT_METHODS.find((name) =>
    reason.includes(`context.${name} is not a function`),
  );
  if (!removed) return undefined;
  const written =
    `context.${removed}() was removed in ESLint 9, so this rule was written for the ` +
    'ESLint 8 rule context.';
  if (resolvedEngine?.source === 'project') {
    return (
      `${written} The project's own ESLint ${resolvedEngine.version} is what ran it, so the ` +
      "project's lint script fails the same way; updating the plugin that owns the rule fixes " +
      'both.'
    );
  }
  const bundled = resolvedEngine ? ` ${resolvedEngine.version}` : '';
  return (
    `${written} ts-migrate linted with the ESLint${bundled} bundled with it (see the engine ` +
    'line at the start of the pass); an ESLint ts-migrate can load from the project would run ' +
    'these rules the way the project does.'
  );
}

/** ESLint hangs the id of the rule that threw on the error it throws. */
function ruleIdOf(error: unknown): string | undefined {
  const ruleId = (error as { ruleId?: unknown } | undefined)?.ruleId;
  return typeof ruleId === 'string' ? ruleId : undefined;
}

/** What is worth keeping from a thrown lint failure, once per cause. */
function lintFailureNotice(error: unknown): PluginFileNotice {
  // ESLint appends "Occurred while linting <file>:<line>" and the rule id to
  // the message; the first line is the cause, and the rest is per-occurrence
  // detail the grouped report carries anyway.
  const reason = errorMessage(error).split('\n')[0].trim();
  return {
    reason,
    ruleId: ruleIdOf(error),
    hint:
      removedContextApiHint(reason) ??
      'If the project lint config cannot be fixed now, --excludePlugin eslint-fix skips this ' +
        'plugin.',
  };
}

// Code inside ESLint sometimes writes straight to the console: a parser
// announcing something about its setup, or a rule left with a debug print.
// Neither is ts-migrate's to lose, and neither can be left alone either. The
// pass counter is drawn in place, so a write that lands under it is overdrawn
// on the next render (this is why ts-migrate's own output goes through
// updatable-log), and typescript-estree's version banner is thirteen lines of
// borders and blank lines that say one thing.
//
// Only the main thread needs this. typescript-estree gates the banner on
// `process.stdout.isTTY`, and a worker's stdout is a pipe to this process,
// never a TTY, so the files that lint in the pool never produce it.
const FILTERED_CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const;
type FilteredConsoleMethod = (typeof FILTERED_CONSOLE_METHODS)[number];
type ConsoleWriter = (...args: unknown[]) => void;

/**
 * A console write ts-migrate recognizes, and the one line worth keeping from
 * it. A `summarize` that returns undefined drops the write outright.
 */
interface KnownConsoleNoise {
  match: RegExp;
  summarize: (text: string) => string | undefined;
}

const KNOWN_CONSOLE_NOISE: KnownConsoleNoise[] = [
  {
    // Printed the first time typescript-estree parses, whenever the compiler
    // in the process is outside the range the @typescript-eslint doing the
    // parsing was released against. ts-migrate runs the project's own compiler
    // (see ts-migrate's utils/resolveTypeScript), so a project whose lint
    // stack is older than its TypeScript sees this on every run.
    match: /not officially supported by @typescript-eslint\/typescript-estree/,
    summarize: (text) => {
      // The two versions are the whole of what the banner says. Its labels are
      // capitalized differently across @typescript-eslint majors.
      const supported = /supported typescript versions:[ \t]*(.+)/i.exec(text)?.[1].trim();
      const running = /your typescript version:[ \t]*(.+)/i.exec(text)?.[1].trim();
      const skew =
        supported && running
          ? `supports TypeScript ${supported} and this migration runs ${running}`
          : 'does not officially support the TypeScript version this migration runs';
      return `[eslint-fix] This project's @typescript-eslint ${skew}, so syntax it does not know can parse wrong.`;
    },
  },
];

function knownNoiseIn(args: unknown[]): KnownConsoleNoise | undefined {
  const [first] = args;
  if (typeof first !== 'string') return undefined;
  return KNOWN_CONSOLE_NOISE.find(({ match }) => match.test(first));
}

/* eslint-disable no-console -- this is what keeps other writers off the console */
let consoleFilterDepth = 0;
const unfilteredConsole = new Map<FilteredConsoleMethod, ConsoleWriter>();

function installConsoleFilter(): void {
  FILTERED_CONSOLE_METHODS.forEach((method) => {
    const original = console[method] as ConsoleWriter;
    unfilteredConsole.set(method, original);
    // Bound: what goes back is the method as it was found, but calling it from
    // the wrapper cannot assume a console hands out bound methods.
    const write = original.bind(console) as ConsoleWriter;
    console[method] = (...args: unknown[]) => {
      const known = knownNoiseIn(args);
      if (known) {
        // The summary goes back out on the channel it came in on, and past
        // this filter rather than through log.info, which would re-enter it.
        const summary = known.summarize(args[0] as string);
        if (summary !== undefined && !log.quiet) {
          log.clear();
          write(summary);
        }
        return;
      }
      // Nothing ts-migrate recognizes is nothing for it to drop. It only has
      // to survive the counter.
      log.clear();
      write(...args);
    };
  });
}

function restoreConsole(): void {
  unfilteredConsole.forEach((write, method) => {
    console[method] = write;
  });
  unfilteredConsole.clear();
}
/* eslint-enable no-console */

/**
 * Filters direct console writes while a lint call is in flight, and returns
 * that call's release. The filter comes off when the last caller releases it,
 * so nothing is left patched between passes.
 */
function filterConsole(): () => void {
  if (consoleFilterDepth === 0) installConsoleFilter();
  consoleFilterDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consoleFilterDepth -= 1;
    if (consoleFilterDepth === 0) restoreConsole();
  };
}

const eslintFixPlugin: Plugin<Options> = {
  name: 'eslint-fix',

  // Each file's fix depends only on that file's own text, so the runner keeps
  // every file's run() in flight at once; the worker pool turns that overlap
  // into parallel lint work.
  independentFiles: true,

  async run(params) {
    const { fileName, rootDir, text, options } = params;
    if (lastFixedText.get(fileName) === text) {
      return text;
    }
    const reportNotice = fileNoticeReporter(params, '[eslint-fix]');
    const releaseConsole = filterConsole();
    pendingLintCalls += 1;
    try {
      // rootDir is the project: where its ESLint is searched for, and where
      // its config is resolved from. It is on every plugin's params; the
      // fallback is for a direct caller that omits it.
      const cli = await getESLint(rootDir ?? process.cwd(), options?.projectEslint !== false);
      const newText = await lintFile(cli, fileName, text, reportNotice);
      lastFixedText.set(fileName, newText);
      return newText;
    } catch (e) {
      reportNotice(lintFailureNotice(e));
      return text;
    } finally {
      pendingLintCalls -= 1;
      releaseConsole();
    }
  },

  validate: createValidate(optionProperties),
};

export default eslintFixPlugin;
