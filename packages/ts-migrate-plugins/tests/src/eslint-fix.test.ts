import { execFileSync } from 'child_process';
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
// PluginParams are unused.
const driverSource = `
const plugin = require('./eslint-fix-plugin.cjs').default;
const [, , fileName, text] = process.argv;
plugin.run({ fileName, text }).then(
  (result) => process.stdout.write(JSON.stringify({ result })),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
`;

function runInFixture(fixture: string, text: string): string | undefined {
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

    const stdout = execFileSync(process.execPath, ['driver.cjs', 'Foo.tsx', text], {
      cwd: tmpDir,
      env,
      encoding: 'utf8',
    });
    return JSON.parse(stdout).result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('eslint-fix plugin', () => {
  it(
    'applies fixes using a flat config (eslint.config.*)',
    () => {
      const result = runInFixture('eslint-flat', `const hello = 'world'`);

      expect(result).toBe(`const hello = 'world';\n`);
    },
    15000,
  );

  it(
    'applies fixes using a legacy .eslintrc config',
    () => {
      const result = runInFixture('eslint-legacy', `const hello = 'world'`);

      expect(result).toBe(`const hello = 'world';\n`);
    },
    15000,
  );
});
