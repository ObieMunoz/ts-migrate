import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { PluginOptionsError } from '@obiemunoz/ts-migrate-server';
import { createTmpDir } from '@obiemunoz/ts-migrate-test-utils';
import { readDriver } from '../test-utils';
import eslintFixPlugin from '../../src/plugins/eslint-fix';

const packageRoot = path.join(__dirname, '..', '..');

// ESLint 9 loads flat configs (`eslint.config.*`) with a dynamic `import()`,
// which jest's module sandbox only supports when node runs with
// --experimental-vm-modules. Run the plugin in a plain node child process so
// the test doesn't depend on how jest was invoked, and inside a temp copy of
// the fixture so configs above it (this package's own eslint.config.js, or
// anything ambient on the machine) can't leak into engine detection or
// ESLint's config search.

const sourceRoot = path.join(packageRoot, 'src');
const pluginEntry = path.join(sourceRoot, 'plugins', 'eslint-fix.ts');
/** Where the entry lands under the temp tree's `plugin` directory. */
const pluginEntryInTree = 'plugins/eslint-fix.js';

// Every module reachable from the plugin over relative specifiers is
// transpiled and written under `plugin/` at the position it has under `src/`,
// so the requires the transpiled files carry resolve the same way they do in
// the source tree. Bare specifiers resolve through NODE_PATH instead: eslint
// from the plugin directory's own node_modules, everything else from this
// package's. That includes @obiemunoz/ts-migrate-server, whose value exports
// (fileNoticeReporter, and PluginOptionsError through utils/validateOptions)
// the graph imports, so these tests read the server's build output. That is
// accepted rather than worked around: `pnpm run build` builds the server
// before any suite runs, in CI and locally.
const MAX_GRAPH_DEPTH = 8;

interface CompiledModule {
  /** Path under `plugin/`, mirroring the source file's path under `src/`. */
  outputPath: string;
  text: string;
}

/** The file a relative specifier names, with the extension TypeScript infers. */
function resolveRelative(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const resolved = ['.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((suffix) => base + suffix)
    .find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Could not resolve '${specifier}' from ${fromFile}`);
  }
  return resolved;
}

let compiledPlugin: CompiledModule[] | undefined;

function getCompiledPlugin(): CompiledModule[] {
  if (!compiledPlugin) {
    const modules = new Map<string, CompiledModule>();
    const visit = (sourcePath: string, depth: number) => {
      if (modules.has(sourcePath)) return;
      if (depth > MAX_GRAPH_DEPTH) {
        throw new Error(`Relative imports go more than ${MAX_GRAPH_DEPTH} deep at ${sourcePath}`);
      }
      const source = fs.readFileSync(sourcePath, 'utf8');
      modules.set(sourcePath, {
        outputPath: `${path.relative(sourceRoot, sourcePath).replace(/\.tsx?$/, '')}.js`,
        text: ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }).outputText,
      });
      ts.preProcessFile(source, true, true)
        .importedFiles.filter(({ fileName }) => fileName.startsWith('.'))
        .forEach(({ fileName }) => visit(resolveRelative(sourcePath, fileName), depth + 1));
    };
    visit(pluginEntry, 0);
    compiledPlugin = [...modules.values()];
  }
  return compiledPlugin;
}

// Only fileName, rootDir, text, options, and reportFileNotice are read by the
// eslint-fix plugin; the other PluginParams are unused. File names are
// resolved against rootDir, which is where the runner's are. Files are
// dispatched together, as the migrate runner does for independentFiles
// plugins, and each one's notices are collected the way the runner collects
// them. The workerData of every spawn is recorded by wrapping
// worker_threads.Worker before the plugin loads. Results go to a file so
// stdout carries only what the plugin logs.
const driverSource = readDriver('eslint-fix-worker-pool.cjs').replace(
  'PLUGIN_ENTRY',
  JSON.stringify(pluginEntryInTree),
);

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

function stubEngineSource({
  broken,
  loadESLint,
}: {
  broken?: boolean;
  loadESLint?: boolean;
}): string {
  // A half-installed copy: the manifest is there, loading it is not.
  if (broken) return "require('a-dependency-that-is-not-installed');\n";
  // 8.57 and later also export loadESLint, which is what a flat config needs.
  if (loadESLint) return `${STUB_ENGINE_SOURCE}module.exports.loadESLint = async () => ESLint;\n`;
  return STUB_ENGINE_SOURCE;
}

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

type ProjectESLint =
  | 'v8'
  | {
      version: string;
      broken?: boolean;
      /** Export loadESLint too, as 8.57 and later do. */
      loadESLint?: boolean;
      /** Install a jiti the project's ESLint can resolve. */
      jiti?: boolean;
    };

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
  fs.writeFileSync(path.join(eslintDir, 'index.js'), stubEngineSource(projectESLint));
  if (projectESLint.jiti) {
    // Only the manifest is read: what the plugin decides is whether the
    // project's ESLint has a jiti to resolve, not what that jiti does.
    const jitiDir = path.join(nodeModules, 'jiti');
    fs.mkdirSync(jitiDir);
    fs.writeFileSync(
      path.join(jitiDir, 'package.json'),
      JSON.stringify({ name: 'jiti', version: '2.4.2' }),
    );
  }
}

interface RunOptions {
  env?: Record<string, string>;
  /** Installed at <fixture>/node_modules/eslint before the run. */
  projectESLint?: ProjectESLint;
  /** The eslint-fix plugin's own options. */
  pluginOptions?: { projectEslint?: boolean };
  /**
   * The migration root, relative to the fixture. The working directory stays
   * at the fixture root, so setting this is what `ts-migrate migrate
   * packages/app` from a repository root looks like to the plugin.
   */
  rootDir?: string;
  /**
   * Where the child process runs, relative to the fixture. A directory that is
   * not an ancestor of the migration root is what running ts-migrate from an
   * unrelated checkout looks like to the plugin.
   */
  workingDir?: string;
}

interface FixtureRun {
  results: (string | undefined)[];
  /** What the plugin reported per file, as the runner would collect it. */
  notices: { file: string; reason: string; ruleId?: string; hint?: string; recovered?: boolean }[];
  spawnedWorkers: number;
  workerData: {
    eslintPath: string;
    eslintRealPath: string;
    useLoadESLint: boolean;
    useFlatConfig: boolean;
    cwd: string;
  }[];
  stdout: string;
  stderr: string;
  /** Where the fixture was copied, for asserting on paths the run printed. */
  tmpDir: string;
}

function runInFixture(
  fixture: string,
  files: { fileName: string; text: string }[],
  {
    env: extraEnv = {},
    projectESLint,
    pluginOptions,
    rootDir: rootSubDir,
    workingDir,
  }: RunOptions = {},
): FixtureRun {
  const tmpDir = createTmpDir('ts-migrate-eslint-fix-');
  try {
    fs.cpSync(path.join(__dirname, '..', 'fixtures', fixture), tmpDir, { recursive: true });
    installProjectDependencies(tmpDir, projectESLint);
    // The plugin gets its own directory with its own node_modules/eslint, the
    // way it sits in an installed ts-migrate: the engine it falls back to has
    // to be its own dependency, not whatever the project happens to hoist.
    const pluginDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(pluginDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(bundledESLintDir(), path.join(pluginDir, 'node_modules', 'eslint'), 'dir');
    // The transpiled files are `.js`, and the fixture above them is a project
    // whose own package.json is none of their business.
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    getCompiledPlugin().forEach(({ outputPath, text }) => {
      const file = path.join(pluginDir, outputPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    });
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

    const rootDir = rootSubDir ? path.join(tmpDir, rootSubDir) : tmpDir;
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      [
        path.join(tmpDir, 'driver.cjs'),
        JSON.stringify({ files, rootDir, options: pluginOptions }),
      ],
      {
        cwd: workingDir ? path.join(tmpDir, workingDir) : tmpDir,
        env,
        encoding: 'utf8',
      },
    );
    if (status !== 0) {
      throw new Error(`driver exited with ${status}: ${stderr}`);
    }
    const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json'), 'utf8'));
    return { ...result, stdout, stderr, tmpDir };
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
    'reports one cause, and returns text unchanged, when the project ESLint cannot parse TypeScript',
    () => {
      // The legacy fixture parses with espree, which rejects type annotations.
      const text = `const hello: any = 'world'`;
      const { results, notices, stderr } = runInFixture('eslint-legacy', [
        { fileName: 'Foo.tsx', text },
        { fileName: 'Bar.tsx', text },
      ]);

      expect(results).toEqual([text, text]);
      // One per file, with the same reason, so the runner reports them as one.
      expect(notices.map(({ file }) => file).sort()).toEqual(['Bar.tsx', 'Foo.tsx']);
      expect(new Set(notices.map(({ reason }) => reason)).size).toBe(1);
      expect(notices[0].reason).toContain('ESLint could not parse the file');
      expect(notices[0].hint).toContain('@typescript-eslint');
      // Nothing is printed from inside the pass.
      expect(stderr).not.toContain('could not parse');
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
    'still reports unparseable files when linting in workers',
    () => {
      const text = `const hello: any = 'world'`;
      const { results, notices, spawnedWorkers } = runInFixture(
        'eslint-legacy',
        [
          { fileName: 'Foo.tsx', text },
          { fileName: 'Bar.tsx', text },
        ],
        { env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([text, text]);
      expect(spawnedWorkers).toBe(2);
      expect(notices).toHaveLength(2);
      expect(new Set(notices.map(({ reason }) => reason)).size).toBe(1);
      expect(notices[0].reason).toContain('ESLint could not parse the file');
    },
    20000,
  );
});

describe('eslint-fix config resolution', () => {
  const unfixed = `const hello = 'world'`;
  const fixed = `const hello = 'world';\n`;
  // Everything below runs with the working directory at the repository root
  // and the migration root at packages/app, which is what `ts-migrate migrate
  // packages/app` looks like from a monorepo root.
  const inPackage = { rootDir: path.join('packages', 'app') };

  it(
    'applies fixes with a flat config under the migration root',
    () => {
      const { results, stdout, tmpDir } = runInFixture(
        'eslint-flat-monorepo',
        [{ fileName: 'src/Foo.js', text: unfixed }],
        inPackage,
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain(
        `[eslint-fix] flat config: ${path.join(tmpDir, 'packages', 'app', 'eslint.config.cjs')}`,
      );
    },
    20000,
  );

  it(
    'still finds a flat config above the migration root',
    () => {
      const { results, stdout, tmpDir } = runInFixture(
        'eslint-flat-above',
        [{ fileName: 'src/Foo.js', text: unfixed }],
        inPackage,
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain(
        `[eslint-fix] flat config: ${path.join(tmpDir, 'eslint.config.cjs')}`,
      );
    },
    20000,
  );

  it(
    'selects the legacy engine for an eslintrc project under the migration root',
    () => {
      const { results, stdout, tmpDir } = runInFixture(
        'eslint-legacy-monorepo',
        [{ fileName: 'src/Foo.js', text: unfixed }],
        inPackage,
      );

      expect(results).toEqual([fixed]);
      expect(stdout).toContain(
        `[eslint-fix] eslintrc config, rooted at ${path.join(tmpDir, 'packages', 'app')}`,
      );
    },
    20000,
  );

  it(
    'ignores a flat config that only the working directory can reach',
    () => {
      const { results, notices, stdout, tmpDir } = runInFixture(
        'eslint-other-checkout',
        [{ fileName: 'src/Foo.js', text: unfixed }],
        { rootDir: 'project', workingDir: 'other' },
      );

      // The eslintrc engine reports the root it searched, per file; the flat
      // engine would have failed every file with "Could not find config file."
      expect(results).toEqual([unfixed]);
      expect(stdout).toContain(
        `[eslint-fix] eslintrc config, rooted at ${path.join(tmpDir, 'project')}`,
      );
      expect(stdout).not.toContain('[eslint-fix] flat config:');
      expect(notices.map(({ reason }) => reason)).toEqual([
        expect.stringContaining('No ESLint configuration found'),
      ]);
    },
    20000,
  );

  it(
    'lets ESLINT_USE_FLAT_CONFIG override what discovery found',
    () => {
      // A flat config is right there under the migration root, and the
      // override still sends the run to the legacy engine, which finds no
      // .eslintrc and leaves the file alone.
      const { results, stdout } = runInFixture(
        'eslint-flat-monorepo',
        [{ fileName: 'src/Foo.js', text: unfixed }],
        { ...inPackage, env: { ESLINT_USE_FLAT_CONFIG: 'false' } },
      );

      expect(results).toEqual([unfixed]);
      expect(stdout).toContain('[eslint-fix] eslintrc config');
      expect(stdout).toContain('[ESLINT_USE_FLAT_CONFIG]');
    },
    20000,
  );

  it(
    'roots pooled workers at the same config the main thread resolved',
    () => {
      const { results, workerData, tmpDir } = runInFixture(
        'eslint-flat-monorepo',
        [
          { fileName: 'src/Foo.js', text: unfixed },
          { fileName: 'src/Bar.js', text: `const bar = 'baz'` },
        ],
        { ...inPackage, env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' } },
      );

      expect(results).toEqual([fixed, `const bar = 'baz';\n`]);
      expect(workerData).toHaveLength(2);
      workerData.forEach((data) => {
        expect(data.cwd).toBe(path.join(tmpDir, 'packages', 'app'));
        expect(data.useFlatConfig).toBe(true);
      });
    },
    30000,
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
    'leaves the same file unfixed under the bundled engine, which --projectEslint=false selects',
    () => {
      const { results, notices, stdout, stderr } = runInFixture(
        'eslint-legacy-plugin',
        [
          { fileName: 'Foo.js', text: unfixed },
          { fileName: 'Bar.js', text: unfixed },
        ],
        { projectESLint: 'v8', pluginOptions: { projectEslint: false } },
      );

      expect(results).toEqual([unfixed, unfixed]);
      expect(stdout).toContain('bundled with ts-migrate; --projectEslint=false');
      // One notice per file, all sharing the cause and the rule that threw, so
      // the runner reports a rule broken by engine skew once for the project.
      expect(notices).toHaveLength(2);
      notices.forEach((notice) => {
        expect(notice.reason).toBe('context.getScope is not a function');
        expect(notice.ruleId).toBe('legacy/uses-old-api');
        expect(notice.hint).toContain('removed in ESLint 9');
        expect(notice.hint).toContain('bundled with it');
      });
      // The per-occurrence detail ESLint appends stays out of the cause.
      expect(notices[0].reason).not.toContain('Occurred while linting');
      expect(stderr).not.toContain('getScope');
    },
    20000,
  );

  it(
    'reports the rule that threw for a file linted in a worker',
    () => {
      const { results, notices, spawnedWorkers } = runInFixture(
        'eslint-legacy-plugin',
        [
          { fileName: 'Foo.js', text: unfixed },
          { fileName: 'Bar.js', text: unfixed },
        ],
        {
          projectESLint: 'v8',
          pluginOptions: { projectEslint: false },
          env: { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' },
        },
      );

      expect(results).toEqual([unfixed, unfixed]);
      expect(spawnedWorkers).toBe(2);
      // The rule id only reaches the main thread if the worker sends it: the
      // error itself does not survive the structured clone.
      expect(notices.map(({ ruleId }) => ruleId)).toEqual([
        'legacy/uses-old-api',
        'legacy/uses-old-api',
      ]);
    },
    30000,
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
    'keeps the bundled engine when no jiti resolves from a project ESLint with a TypeScript config',
    () => {
      const { results, stdout, stderr } = runInFixture(
        'eslint-flat-ts',
        [
          { fileName: 'Foo.js', text: unfixed },
          { fileName: 'Bar.js', text: unfixed },
        ],
        { projectESLint: { version: '9.39.0', loadESLint: true } },
      );

      // The bundled engine has jiti, so the project's own eslint.config.ts is
      // still what lints, and the cause is stated once rather than per file.
      expect(results).toEqual([fixed, fixed]);
      expect(stdout).toContain(
        'project has eslint 9.39.0, which cannot load a TypeScript config without jiti installed',
      );
      expect(
        stderr.match(/This project's eslint 9\.39\.0 cannot load a TypeScript config/g),
      ).toHaveLength(1);
    },
    20000,
  );

  it(
    'runs a TypeScript config under the project ESLint when jiti resolves from it',
    () => {
      const { results, stdout } = runInFixture(
        'eslint-flat-ts',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: { version: '9.39.0', loadESLint: true, jiti: true } },
      );

      expect(results).toEqual([unfixed + PROJECT_ENGINE_MARKER]);
      expect(stdout).toContain('[eslint-fix] ESLint 9.39.0 (project:');
    },
    20000,
  );

  it(
    'keeps a project ESLint without jiti for a config that is not TypeScript',
    () => {
      const { results, stdout } = runInFixture(
        'eslint-flat',
        [{ fileName: 'Foo.js', text: unfixed }],
        { projectESLint: { version: '9.39.0', loadESLint: true } },
      );

      expect(results).toEqual([unfixed + PROJECT_ENGINE_MARKER]);
      expect(stdout).toContain('[eslint-fix] ESLint 9.39.0 (project:');
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

describe('eslint-fix options', () => {
  it('validates options', () => {
    const { validate } = eslintFixPlugin;
    if (!validate) throw new Error('expected validate to be defined');
    expect(validate({})).toBe(true);
    expect(validate({ projectEslint: true })).toBe(true);
    expect(validate({ projectEslint: false })).toBe(true);
    expect(() => validate({ projectEslint: 'yes' })).toThrow(PluginOptionsError);
    expect(() => validate({ projectESLint: true })).toThrow(PluginOptionsError);
  });
});
