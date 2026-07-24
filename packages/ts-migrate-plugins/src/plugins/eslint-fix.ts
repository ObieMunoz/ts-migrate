import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import type { loadESLint } from 'eslint';
import { Plugin } from '@obiemunoz/ts-migrate-server';

// Either the flat-config or legacy engine; both expose the `lintText` API.
type AnyESLint = InstanceType<Awaited<ReturnType<typeof loadESLint>>>;

export type Options = {
  /**
   * Lint with the project's own ESLint when one is installed and usable
   * (default). False pins the copy bundled with ts-migrate.
   */
  projectEslint?: boolean;
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

// Whether a flat config (`eslint.config.*`) is discoverable from `cwd` upward.
// ESLint 9 always defaults to flat config, so we detect it to fall back to the
// legacy `.eslintrc` engine when absent.
function hasFlatConfig(cwd: string): boolean {
  let dir = cwd;
  while (true) {
    if (FLAT_CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

// Respect an explicit ESLINT_USE_FLAT_CONFIG override if set; otherwise pick
// flat vs. legacy based on whether a flat config file exists.
function shouldUseFlatConfig(): boolean {
  return process.env.ESLINT_USE_FLAT_CONFIG != null
    ? process.env.ESLINT_USE_FLAT_CONFIG !== 'false'
    : hasFlatConfig(process.cwd());
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
  useFlatConfig: boolean;
  /** A project copy that was found and not used, and why. */
  refused?: { version: string; reason: string };
  /** The bundled engine was asked for by name, so nothing is a compromise. */
  optedOut?: boolean;
}

type ESLintConstructor = new (options: { fix: boolean; ignore: boolean }) => AnyESLint;

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

function readESLintVersion(packageDir: string): string | undefined {
  try {
    const { name, version } = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'),
    );
    return name === 'eslint' && typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The ESLint the project's own `eslint` would run: an explicit ancestor walk
 * rather than require.resolve, whose global fallbacks (NODE_PATH, global
 * installs) can name a copy the project itself would never load.
 */
function findProjectESLint(rootDir: string): { packageDir: string; version: string } | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', 'eslint');
    const version = readESLintVersion(packageDir);
    if (version) return { packageDir, version };
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The ESLint installed alongside ts-migrate, used when the project's is not. */
function findBundledESLint(): { entryPath: string; version: string } {
  const entryPath = require.resolve('eslint');
  for (let dir = path.dirname(entryPath); ; dir = path.dirname(dir)) {
    const version = readESLintVersion(dir);
    if (version) return { entryPath, version };
    if (path.dirname(dir) === dir) return { entryPath, version: 'unknown version' };
  }
}

function resolveESLintEngine(
  rootDir: string,
  useProjectESLint: boolean,
  useFlatConfig: boolean,
): ESLintEngine {
  const bundled = findBundledESLint();
  const useBundled = (extra: Partial<ESLintEngine> = {}): ESLintEngine => ({
    ...bundled,
    source: 'bundled',
    module: require(bundled.entryPath),
    useFlatConfig,
    ...extra,
  });

  if (!useProjectESLint) return useBundled({ optedOut: true });

  const project = findProjectESLint(rootDir);
  if (!project) return useBundled();

  const refuse = (reason: string) => useBundled({ refused: { version: project.version, reason } });

  const major = Number.parseInt(project.version, 10);
  if (!Number.isInteger(major) || major < MIN_PROJECT_MAJOR) {
    return refuse(`below the ESLint ${MIN_PROJECT_MAJOR} floor ts-migrate can load`);
  }

  let projectModule: ESLintModule;
  try {
    projectModule = require(project.packageDir);
  } catch (error) {
    return refuse(`could not be loaded (${error instanceof Error ? error.message : error})`);
  }

  if (typeof projectModule.loadESLint !== 'function') {
    if (typeof projectModule.ESLint !== 'function') {
      return refuse('exports neither loadESLint nor an ESLint class');
    }
    if (useFlatConfig) {
      // 8.0 through 8.56 reach flat config only through
      // eslint/use-at-your-own-risk, which is not an API to hold a migration to.
      return refuse('predates flat config support in the ESLint public API (8.57)');
    }
  }

  return {
    entryPath: project.packageDir,
    version: project.version,
    source: 'project',
    module: projectModule,
    useFlatConfig,
  };
}

/** The run banner: which engine lints, and why it was that one. */
function describeESLintEngine(engine: ESLintEngine): string {
  if (engine.source === 'project') {
    return `[eslint-fix] ESLint ${engine.version} (project: ${engine.entryPath})`;
  }
  let why = 'project has no eslint installed';
  if (engine.optedOut) {
    why = '--no-projectEslint';
  } else if (engine.refused) {
    why = `project has eslint ${engine.refused.version}, ${engine.refused.reason}`;
  }
  return `[eslint-fix] ESLint ${engine.version} (bundled with ts-migrate; ${why})`;
}

// Lazily create one ESLint instance, shared across all files in a run.
// (`jiti`, a dependency, is what lets ESLint load a TypeScript `eslint.config.ts`.)
let eslintPromise: Promise<AnyESLint> | undefined;
// Set with it, and read when spawning workers so they load the same engine.
let resolvedEngine: ESLintEngine | undefined;

async function createESLint(rootDir: string, useProjectESLint: boolean): Promise<AnyESLint> {
  const useFlatConfig = shouldUseFlatConfig();
  const engine = resolveESLintEngine(rootDir, useProjectESLint, useFlatConfig);
  resolvedEngine = engine;

  console.log(describeESLintEngine(engine));
  if (engine.refused) {
    console.warn(
      `[eslint-fix] This project has eslint ${engine.refused.version} installed, which is ` +
        `${engine.refused.reason}; linting with the ESLint ${engine.version} bundled with ` +
        'ts-migrate instead. Rules and plugins pinned to the project ESLint can fail under ' +
        'it, and files whose rules throw come back unfixed.',
    );
  }

  const options = {
    fix: true,
    // Set ignore to false so we can lint in `tmp` for testing.
    ignore: false,
  };
  if (typeof engine.module.loadESLint === 'function') {
    const ESLintClass = await engine.module.loadESLint({ useFlatConfig });
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

// The exact text eslint-fix last produced for each file. eslint's autofix is
// idempotent, so a file whose text is unchanged since then is already at a
// fixed point and re-linting it is a guaranteed no-op. This lets the second
// eslint-fix pass (which runs after ts-ignore) skip every file ts-ignore left
// untouched instead of re-linting the whole project.
const lastFixedText = new Map<string, string>();

// Warned at most once per run: a project whose ESLint parser is not
// TypeScript-aware fails the same way for every file.
let warnedAboutParseErrors = false;

function warnOnceAboutParseError(fileName: string, message: string): void {
  if (warnedAboutParseErrors) return;
  warnedAboutParseErrors = true;
  console.warn(
    `[eslint-fix] ESLint could not parse ${fileName} (${message}). ` +
      'Lint fixes are skipped for files ESLint cannot parse. If this is a TypeScript ' +
      'file, the project ESLint config likely needs the @typescript-eslint parser.',
  );
}

async function fixToStable(cli: AnyESLint, fileName: string, text: string): Promise<string> {
  let newText = text;
  while (true) {
    const [report] = await cli.lintText(newText, {
      filePath: fileName,
    });

    const fatalMessage = report?.messages?.find((message) => message.fatal);
    if (fatalMessage) {
      warnOnceAboutParseError(fileName, fatalMessage.message);
    }

    if (!report || !report.output || report.output === newText) {
      break;
    }
    newText = report.output;
  }
  return newText;
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
// (compiled dist, ts-jest, and the transpile-to-temp-dir test harness). Keep
// its lint loop in sync with fixToStable above.
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
    const options = { fix: true, ignore: false };
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
    while (true) {
      const [report] = await cli.lintText(newText, { filePath: fileName });
      const fatal = report && report.messages && report.messages.find((m) => m.fatal);
      if (fatal && fatalMessage === undefined) fatalMessage = fatal.message;
      if (!report || !report.output || report.output === newText) break;
      newText = report.output;
    }
    parentPort.postMessage({ ok: true, text: newText, fatalMessage });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
`;

type WorkerResult =
  | { ok: true; text: string; fatalMessage?: string }
  | { ok: false; error: string };

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
  // A job only reaches the pool after getESLint resolved, so the engine the
  // main thread lints with is the one workers are handed.
  if (!resolvedEngine) {
    throw new Error('eslint-fix: no ESLint engine has been resolved yet');
  }
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      eslintPath: resolvedEngine.entryPath,
      useLoadESLint: typeof resolvedEngine.module.loadESLint === 'function',
      typeScriptDir: typeScriptPackageDir(),
      useFlatConfig: resolvedEngine.useFlatConfig,
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

// Warned at most once per run: once the pool breaks it stays disabled.
let warnedAboutPoolFailure = false;

async function routeToPool(cli: AnyESLint, fileName: string): Promise<boolean> {
  return shouldEnablePool() && shouldLintInWorker(cli, fileName);
}

// Returns undefined when the pool infrastructure failed (the file still needs
// linting in-process); lint-level errors throw, as they do in-process.
async function tryPool(fileName: string, text: string): Promise<string | undefined> {
  let result: WorkerResult;
  try {
    result = await runJobInPool(fileName, text);
  } catch (poolError) {
    if (!warnedAboutPoolFailure) {
      warnedAboutPoolFailure = true;
      const message = poolError instanceof Error ? poolError.message : String(poolError);
      console.warn(`[eslint-fix] Lint workers unavailable (${message}); linting in-process.`);
    }
    return undefined;
  }
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (result.fatalMessage !== undefined) {
    warnOnceAboutParseError(fileName, result.fatalMessage);
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

async function lintFile(cli: AnyESLint, fileName: string, text: string): Promise<string> {
  if (await routeToPool(cli, fileName)) {
    const pooled = await tryPool(fileName, text);
    if (pooled !== undefined) return pooled;
    // Pool broke; take the in-process route below (the gate is now off).
  }
  const outcome = inProcessChain.then(async (): Promise<{ handoff: boolean; fixed?: string }> => {
    if (await routeToPool(cli, fileName)) {
      return { handoff: true };
    }
    const started = Date.now();
    const fixed = await fixToStable(cli, fileName, text);
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
    return lintFile(cli, fileName, text);
  }
  return result.fixed as string;
}

const eslintFixPlugin: Plugin<Options> = {
  name: 'eslint-fix',

  // Each file's fix depends only on that file's own text, so the runner keeps
  // every file's run() in flight at once; the worker pool turns that overlap
  // into parallel lint work.
  independentFiles: true,

  async run({ fileName, rootDir, text, options }) {
    if (lastFixedText.get(fileName) === text) {
      return text;
    }
    pendingLintCalls += 1;
    try {
      // rootDir is where the project's ESLint is searched for. It is on every
      // plugin's params; the fallback is for a direct caller that omits it,
      // and matches the root the flat-config detection above uses.
      const cli = await getESLint(rootDir ?? process.cwd(), options?.projectEslint !== false);
      const newText = await lintFile(cli, fileName, text);
      lastFixedText.set(fileName, newText);
      return newText;
    } catch (e) {
      console.error('Error occurred in eslint-fix plugin: ', e instanceof Error ? e.message : e);
      return text;
    } finally {
      pendingLintCalls -= 1;
    }
  },
};

export default eslintFixPlugin;
