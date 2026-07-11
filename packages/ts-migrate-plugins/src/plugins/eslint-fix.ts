import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { loadESLint } from 'eslint';
import { Plugin } from '@obiemunoz/ts-migrate-server';

// Either the flat-config or legacy engine; both expose the `lintText` API.
type AnyESLint = InstanceType<Awaited<ReturnType<typeof loadESLint>>>;

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

// Lazily create one ESLint instance, shared across all files in a run.
// (`jiti`, a dependency, is what lets ESLint load a TypeScript `eslint.config.ts`.)
let eslintPromise: Promise<AnyESLint> | undefined;

function getESLint(): Promise<AnyESLint> {
  if (!eslintPromise) {
    eslintPromise = loadESLint({ useFlatConfig: shouldUseFlatConfig() }).then(
      (ESLintClass) =>
        new ESLintClass({
          fix: true,
          // Set ignore to false so we can lint in `tmp` for testing.
          ignore: false,
        }),
    );
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

// The worker body is inlined so it survives every way this plugin is loaded
// (compiled dist, ts-jest, and the transpile-to-temp-dir test harness). Keep
// its lint loop in sync with fixToStable above.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { loadESLint } = require(workerData.eslintPath);

let cliPromise;
function getCli() {
  if (!cliPromise) {
    cliPromise = loadESLint({ useFlatConfig: workerData.useFlatConfig }).then(
      (ESLintClass) => new ESLintClass({ fix: true, ignore: false }),
    );
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
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      eslintPath: require.resolve('eslint'),
      useFlatConfig: shouldUseFlatConfig(),
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

const eslintFixPlugin: Plugin = {
  name: 'eslint-fix',

  // Each file's fix depends only on that file's own text, so the runner keeps
  // every file's run() in flight at once; the worker pool turns that overlap
  // into parallel lint work.
  independentFiles: true,

  async run({ fileName, text }) {
    if (lastFixedText.get(fileName) === text) {
      return text;
    }
    pendingLintCalls += 1;
    try {
      const cli = await getESLint();
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
