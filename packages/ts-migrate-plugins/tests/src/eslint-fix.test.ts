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

// Only fileName and text are read by the eslint-fix plugin; the other
// PluginParams are unused. Files are dispatched together, as the migrate
// runner does for independentFiles plugins. Worker spawns are counted by
// wrapping worker_threads.Worker before the plugin loads.
const driverSource = `
const workerThreads = require('worker_threads');
const RealWorker = workerThreads.Worker;
let spawnedWorkers = 0;
workerThreads.Worker = class extends RealWorker {
  constructor(...args) {
    spawnedWorkers += 1;
    super(...args);
  }
};
const plugin = require('./eslint-fix-plugin.cjs').default;
const files = JSON.parse(process.argv[2]);
(async () => {
  const results = await Promise.all(
    files.map(({ fileName, text }) => plugin.run({ fileName, text })),
  );
  process.stdout.write(JSON.stringify({ results, spawnedWorkers }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

interface FixtureRun {
  results: (string | undefined)[];
  spawnedWorkers: number;
  stderr: string;
}

function runInFixture(
  fixture: string,
  files: { fileName: string; text: string }[],
  extraEnv: Record<string, string> = {},
): FixtureRun {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-eslint-fix-'));
  try {
    fs.cpSync(path.join(__dirname, '..', 'fixtures', fixture), tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'eslint-fix-plugin.cjs'), getCompiledPlugin());
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
      ['driver.cjs', JSON.stringify(files)],
      {
        cwd: tmpDir,
        env,
        encoding: 'utf8',
      },
    );
    if (status !== 0) {
      throw new Error(`driver exited with ${status}: ${stderr}`);
    }
    return { ...JSON.parse(stdout), stderr };
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
        { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' },
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
        { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' },
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
        { TS_MIGRATE_ESLINT_FIX_WORKERS: '' },
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
        { TS_MIGRATE_ESLINT_FIX_WORKERS: '2' },
      );

      expect(results).toEqual([text, text]);
      expect(spawnedWorkers).toBe(2);
      expect(stderr.match(/ESLint could not parse/g)).toHaveLength(1);
    },
    20000,
  );
});
