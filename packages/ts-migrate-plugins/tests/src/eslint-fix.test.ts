import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

const packageRoot = path.join(__dirname, '..', '..');

// ESLint 9 loads flat configs (`eslint.config.*`) with a dynamic `import()`,
// which jest's module sandbox only supports when node runs with
// --experimental-vm-modules. Run the plugin in a plain node child process so
// the test doesn't depend on how jest was invoked, and inside a temp copy of
// the fixture so configs above it (this package's own eslint.config.js, or
// anything ambient on the machine) can't leak into engine detection or
// ESLint's config search.

let compiledPlugin: string | undefined;

function getCompiledPlugin(): string {
  if (!compiledPlugin) {
    const source = fs.readFileSync(
      path.join(packageRoot, 'src', 'plugins', 'eslint-fix.ts'),
      'utf8',
    );
    compiledPlugin = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;
  }
  return compiledPlugin;
}

// Only fileName, rootDir, text, and options are read by the eslint-fix
// plugin; the other PluginParams are unused. Files are dispatched together,
// as the migrate runner does for independentFiles plugins. The workerData of
// every spawn is recorded by wrapping worker_threads.Worker before the plugin
// loads. Results go to a file so stdout carries only what the plugin logs.
const driverSource = `
const fs = require('fs');
const path = require('path');
const workerThreads = require('worker_threads');
const RealWorker = workerThreads.Worker;
const workerData = [];
workerThreads.Worker = class extends RealWorker {
  constructor(source, options) {
    workerData.push(options && options.workerData);
    super(source, options);
  }
};
const plugin = require('./plugin/eslint-fix-plugin.cjs').default;
const { files, rootDir, options } = JSON.parse(process.argv[2]);
(async () => {
  const results = await Promise.all(
    files.map(({ fileName, text }) => plugin.run({ fileName, rootDir, text, options })),
  );
  fs.writeFileSync(
    path.join(__dirname, 'result.json'),
    JSON.stringify({
      results,
      // The temp tree is gone by the time the test reads this.
      workerData: workerData.map((data) => ({
        ...data,
        eslintRealPath: fs.realpathSync(data.eslintPath),
      })),
      spawnedWorkers: workerData.length,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

/** A stand-in for a project ESLint, to pin an export shape a test needs. */
const STUB_ENGINE_SOURCE = `
// Exports only the ESLint class, as 8.0 through 8.56 do. The marker it
// appends is how a test tells which engine produced the text.
const MARKER = '// linted by the project engine\\n';
class ESLint {
  async lintText(text, { filePath }) {
    return [{ filePath, messages: [], output: text.endsWith(MARKER) ? text : text + MARKER }];
  }
  async calculateConfigForFile() {
    return {};
  }
}
module.exports = { ESLint };
`;

const PROJECT_ENGINE_MARKER = '// linted by the project engine\n';

function packageDir(specifier: string): string {
  return fs.realpathSync(
    path.dirname(require.resolve(`${specifier}/package.json`, { paths: [packageRoot] })),
  );
}

/** The real ESLint 8, installed as an aliased devDependency. */
const realESLint8Dir = () => packageDir('eslint-v8');
/** The ESLint this package depends on, which is the fallback engine. */
const bundledESLintDir = () => packageDir('eslint');
const bundledESLintVersion = () =>
  JSON.parse(fs.readFileSync(path.join(bundledESLintDir(), 'package.json'), 'utf8')).version;

type ProjectESLint = 'v8' | { version: string; broken?: boolean };

// Git will not track a directory named node_modules, so a fixture keeps the
// packages its config needs in `deps` and they are installed on the way in.
function installProjectDependencies(tmpDir: string, projectESLint?: ProjectESLint): void {
  const nodeModules = path.join(tmpDir, 'node_modules');
  const deps = path.join(tmpDir, 'deps');
  if (fs.existsSync(deps)) {
    fs.renameSync(deps, nodeModules);
  }
  if (!projectESLint) return;

  fs.mkdirSync(nodeModules, { recursive: true });
  const eslintDir = path.join(nodeModules, 'eslint');
  if (projectESLint === 'v8') {
    fs.symlinkSync(realESLint8Dir(), eslintDir, 'dir');
    return;
  }
  fs.mkdirSync(eslintDir);
  fs.writeFileSync(
    path.join(eslintDir, 'package.json'),
    JSON.stringify({ name: 'eslint', version: projectESLint.version, main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(eslintDir, 'index.js'),
    // A half-installed copy: the manifest is there, loading it is not.
    projectESLint.broken ? "require('a-dependency-that-is-not-installed');\n" : STUB_ENGINE_SOURCE,
  );
}

interface RunOptions {
  env?: Record<string, string>;
  /** Installed at <fixture>/node_modules/eslint before the run. */
  projectESLint?: ProjectESLint;
  /** The eslint-fix plugin's own options. */
  pluginOptions?: { projectEslint?: boolean };
}

interface FixtureRun {
  results: (string | undefined)[];
  spawnedWorkers: number;
  workerData: { eslintPath: string; eslintRealPath: string; useLoadESLint: boolean }[];
  stdout: string;
  stderr: string;
}

function runInFixture(
  fixture: string,
  files: { fileName: string; text: string }[],
  { env: extraEnv = {}, projectESLint, pluginOptions }: RunOptions = {},
): FixtureRun {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-eslint-fix-'));
  try {
    fs.cpSync(path.join(__dirname, '..', 'fixtures', fixture), tmpDir, { recursive: true });
    installProjectDependencies(tmpDir, projectESLint);
    // The plugin gets its own directory with its own node_modules/eslint, the
    // way it sits in an installed ts-migrate: the engine it falls back to has
    // to be its own dependency, not whatever the project happens to hoist.
    const pluginDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(pluginDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(bundledESLintDir(), path.join(pluginDir, 'node_modules', 'eslint'), 'dir');
    fs.writeFileSync(path.join(pluginDir, 'eslint-fix-plugin.cjs'), getCompiledPlugin());
    fs.writeFileSync(path.join(tmpDir, 'driver.cjs'), driverSource);

    const env = { ...process.env };
    delete env.ESLINT_USE_FLAT_CONFIG;
    delete env.NODE_OPTIONS;
    env.NODE_PATH = [
      path.join(packageRoot, 'node_modules'),
      path.join(packageRoot, '..', '..', 'node_modules'),
    ].join(path.delimiter);
    // Lint in-process unless a test opts into the worker pool, so each test
    // pins the code path it means to cover regardless of the host's cores.
    env.TS_MIGRATE_ESLINT_FIX_WORKERS = '0';
    Object.assign(env, extraEnv);

    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ['driver.cjs', JSON.stringify({ files, rootDir: tmpDir, options: pluginOptions })],
      {
        cwd: tmpDir,
        env,
        encoding: 'utf8',
      },
    );
    if (status !== 0) {
      throw new Error(`driver exited with ${status}: ${stderr}`);
    }
    const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json'), 'utf8'));
    return { ...result, stdout, stderr };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('eslint-fix plugin', () => {
  it(
    'applies fixes using a flat config (eslint.config.*)',
    () => {
      const { results, spawnedWorkers } = runInFixture('eslint-flat', [
        { fileName: 'Foo.tsx', text: `const hello = 'world'` },
      ]);

      expect(results).toEqual([`const hello = 'world';\n`]);
      expect(spawnedWorkers).toBe(0);
    },
    15000,
  );

  it(
    'applies fixes using a legacy .eslintrc config',
    () => {
      const { results } = runInFixture('eslint-legacy', [
        { fileName: 'Foo.tsx', text: `const hello = 'world'` },
      ]);

      expect(results).toEqual([`const hello = 'world';\n`]);
    },
    15000,
  );

  it(
    'warns once, returns text unchanged, when the project ESLint cannot parse TypeScript',
    () => {
      // The legacy fixture parses with espree, which rejects type annotations.
      const text = `const hello: any = 'world'`;
      const { results, stderr } = runInFixture('eslint-legacy', [
        { fileName: 'Foo.tsx', text },
        { fileName: 'Bar.tsx', text },
      ]);

      expect(results).toEqual([text, text]);
      expect(stderr.match(/ESLint could not parse/g)).toHaveLength(1);
      expect(stderr).toContain('@typescript-eslint');
    },
    15000,
  );

  it(
    'fixes files in worker threads when the config is not type-aware',
    () => {
      const { results, spawnedWorkers } = runInFixture(
        'eslint-flat',
        [
          { fileName: 'Foo.tsx', text: `const hello = 'world'` },
          { fileName: 'Bar.tsx', text: `const bar = 'baz'` },
          { fileName: 'Ok.tsx', text: `const ok = 'yes';\n` },
        ],
        { env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([
        `const hello = 'world';\n`,
        `const bar = 'baz';\n`,
        `const ok = 'yes';\n`,
      ]);
      expect(spawnedWorkers).toBe(2);
    },
    20000,
  );

  it(
    'keeps a type-aware config in-process instead of spawning workers',
    () => {
      const { results, spawnedWorkers } = runInFixture(
        'eslint-flat-type-aware',
        [{ fileName: 'Foo.tsx', text: `const hello = 'world'` }],
        { env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([`const hello = 'world';\n`]);
      expect(spawnedWorkers).toBe(0);
    },
    20000,
  );

  it(
    'stays in-process when the measured lint work would not repay worker spin-up',
    () => {
      // Empty env value means no explicit worker count: the adaptive gate
      // decides, and two cheap files are nowhere near worthwhile.
      const { results, spawnedWorkers } = runInFixture(
        'eslint-flat',
        [
          { fileName: 'Foo.tsx', text: `const hello = 'world'` },
          { fileName: 'Bar.tsx', text: `const bar = 'baz'` },
        ],
        { env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '' } },
      );

      expect(results).toEqual([`const hello = 'world';\n`, `const bar = 'baz';\n`]);
      expect(spawnedWorkers).toBe(0);
    },
    20000,
  );

  it(
    'still warns once about unparseable files when linting in workers',
    () => {
      const text = `const hello: any = 'world'`;
      const { results, stderr, spawnedWorkers } = runInFixture(
        'eslint-legacy',
        [
          { fileName: 'Foo.tsx', text },
          { fileName: 'Bar.tsx', text },
        ],
        { env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([text, text]);
      expect(spawnedWorkers).toBe(2);
      expect(stderr.match(/ESLint could not parse/g)).toHaveLength(1);
    },
    20000,
  );
});

describe('eslint-fix engine selection', () => {
  const unfixed = `const hello = 'world'`;
  const fixed = `const hello = 'world';\n`;

  it(
    "runs a rule that uses the removed ESLint 8 context API under the project's ESLint",
    () => {
      const { results, stdout, stderr } = runInFixture(
        'eslint-legacy-plugin',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: 'v8' },
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain('[eslint-fix] ESLint 8.57.1 (project:');
      expect(stderr).not.toContain('getScope');
    },
    20000,
  );

  it(
    'leaves the same file unfixed under the bundled engine, which --no-projectEslint selects',
    () => {
      const { results, stdout, stderr } = runInFixture(
        'eslint-legacy-plugin',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: 'v8', pluginOptions: { projectEslint: false } },
      );

      expect(results).toEqual([unfixed]);
      expect(stdout).toContain('bundled with ts-migrate; --no-projectEslint');
      expect(stderr).toContain('context.getScope is not a function');
    },
    20000,
  );

  it(
    'enters a project ESLint that exports no loadESLint through its ESLint class',
    () => {
      const { results, stdout } = runInFixture(
        'eslint-legacy',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: { version: '8.30.0' } },
      );

      expect(results).toEqual([unfixed + PROJECT_ENGINE_MARKER]);
      expect(stdout).toContain('[eslint-fix] ESLint 8.30.0 (project:');
    },
    20000,
  );

  it(
    'falls back to the bundled engine, naming the version, below the supported floor',
    () => {
      const { results, stdout, stderr } = runInFixture(
        'eslint-legacy',
        [
          { fileName: 'Foo.js', text: unfixed },
          { fileName: 'Bar.js', text: unfixed },
        ],
        { projectESLint: { version: '7.32.0' } },
      );

      expect(results).toEqual([fixed, fixed]);
      expect(stdout).toContain(
        `[eslint-fix] ESLint ${bundledESLintVersion()} (bundled with ts-migrate; ` +
          'project has eslint 7.32.0, which is below the ESLint 8 floor ts-migrate can load)',
      );
      expect(stderr.match(/This project's eslint 7\.32\.0 is below/g)).toHaveLength(1);
    },
    20000,
  );

  it(
    'falls back to the bundled engine when the project ESLint will not load',
    () => {
      const { results, stdout, stderr } = runInFixture(
        'eslint-legacy',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: { version: '9.39.0', broken: true } },
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain('project has eslint 9.39.0, which could not be loaded');
      expect(stderr).toContain("This project's eslint 9.39.0 could not be loaded");
    },
    20000,
  );

  it(
    'keeps the bundled engine, and says so, when the project has no ESLint',
    () => {
      const { results, stdout, stderr } = runInFixture('eslint-legacy', [
        { fileName: 'Foo.js', text: unfixed },
      ]);

      expect(results).toEqual([fixed]);
      expect(stdout).toContain('bundled with ts-migrate; project has no eslint installed');
      expect(stderr).toBe('');
    },
    20000,
  );

  it(
    'keeps the bundled engine for a flat config the project ESLint cannot load',
    () => {
      const { results, stdout } = runInFixture(
        'eslint-flat',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: { version: '8.30.0' } },
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain(
        'project has eslint 8.30.0, which predates flat config support in the ESLint public API ' +
          '(8.57)',
      );
    },
    20000,
  );

  it(
    'hands workers the engine the main thread resolved',
    () => {
      const { results, workerData } = runInFixture(
        'eslint-legacy-plugin',
        [
          { fileName: 'Foo.js', text: unfixed },
          { fileName: 'Bar.js', text: `const bar = 'baz'` },
        ],
        { projectESLint: 'v8', env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([fixed, `const bar = 'baz';\n`]);
      expect(workerData).toHaveLength(2);
      workerData.forEach((data) => {
        expect(data.eslintRealPath).toBe(realESLint8Dir());
        expect(data.useLoadESLint).toBe(true);
      });
    },
    30000,
  );
});
