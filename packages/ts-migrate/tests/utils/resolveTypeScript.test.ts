import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import {
  SUPPORTED_RANGE,
  describeTypeScript,
  findProjectTypeScript,
  migrationRootFromArgv,
  readTypeScriptOverride,
  resolveTypeScript,
  typeScriptOverrideFromArgv,
  typeScriptWarning,
} from '../../utils/resolveTypeScript';

const packageRoot = path.resolve(__dirname, '..', '..');

// Fixtures live outside the repository: the ancestor walk under test would
// otherwise find this repo's own typescript above tests/tmp.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-resolve-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A typescript package whose exports say which copy answered a require. */
function writeTypeScriptPackage(dir: string, version: string): string {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'typescript', version, main: './lib/typescript.js' }),
  );
  fs.writeFileSync(
    path.join(dir, 'lib', 'typescript.js'),
    `module.exports = { version: ${JSON.stringify(version)} };\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'lib', 'tsserverlibrary.js'),
    `module.exports = { version: ${JSON.stringify(version)}, subpath: true };\n`,
  );
  return dir;
}

function installTypeScript(projectDir: string, version: string): string {
  return writeTypeScriptPackage(path.join(projectDir, 'node_modules', 'typescript'), version);
}

describe('findProjectTypeScript', () => {
  it('finds the nearest install, walking up from the migration root', () => {
    const rootInstall = installTypeScript(tmpDir, '5.4.5');
    const appDir = path.join(tmpDir, 'packages', 'app');
    fs.mkdirSync(appDir, { recursive: true });

    expect(findProjectTypeScript(appDir)).toEqual({ packageDir: rootInstall, version: '5.4.5' });

    const appInstall = installTypeScript(appDir, '5.6.2');
    expect(findProjectTypeScript(appDir)).toEqual({ packageDir: appInstall, version: '5.6.2' });
    expect(findProjectTypeScript(tmpDir)).toEqual({ packageDir: rootInstall, version: '5.4.5' });
  });

  it('ignores a node_modules/typescript that is not the compiler package', () => {
    const packageDir = path.join(tmpDir, 'node_modules', 'typescript');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'typescript-eslint-shim', version: '1.0.0' }),
    );

    expect(findProjectTypeScript(tmpDir)).toBeUndefined();
  });
});

describe('resolveTypeScript', () => {
  it("uses the project's compiler when its version is supported", () => {
    const packageDir = installTypeScript(tmpDir, '5.7.3');

    const decision = resolveTypeScript({ rootDir: tmpDir });

    expect(decision).toEqual({ packageDir, version: '5.7.3', source: 'project' });
    expect(describeTypeScript(decision)).toBe(`TypeScript 5.7.3 (project: ${packageDir})`);
    expect(typeScriptWarning(decision)).toBeUndefined();
  });

  it('refuses a project compiler outside the supported range and names both versions', () => {
    const packageDir = installTypeScript(tmpDir, '4.9.5');

    const decision = resolveTypeScript({ rootDir: tmpDir });

    expect(decision.source).toBe('bundled');
    expect(decision.version).toBe(ts.version);
    expect(decision.refused).toEqual({
      packageDir,
      version: '4.9.5',
      reason: expect.stringContaining(SUPPORTED_RANGE),
    });
    expect(describeTypeScript(decision)).toBe(
      `TypeScript ${ts.version} (bundled with ts-migrate; project has typescript 4.9.5, ` +
        `outside the range ts-migrate supports (${SUPPORTED_RANGE}))`,
    );
    expect(typeScriptWarning(decision)).toContain('typescript 4.9.5');
    expect(typeScriptWarning(decision)).toContain(ts.version);
  });

  it('falls back to the bundled compiler when the project has none', () => {
    const decision = resolveTypeScript({ rootDir: tmpDir });

    expect(decision.source).toBe('bundled');
    expect(decision.version).toBe(ts.version);
    expect(decision.refused).toBeUndefined();
    expect(describeTypeScript(decision)).toBe(
      `TypeScript ${ts.version} (bundled with ts-migrate; project has no typescript installed)`,
    );
    expect(typeScriptWarning(decision)).toContain('no typescript installed');
  });

  it('honors --typescript over the project install, and warns outside the range', () => {
    installTypeScript(tmpDir, '5.7.3');
    const overrideDir = writeTypeScriptPackage(path.join(tmpDir, 'vendor', 'typescript'), '7.1.0');

    const decision = resolveTypeScript({ rootDir: tmpDir, override: overrideDir });

    expect(decision).toEqual({ packageDir: overrideDir, version: '7.1.0', source: 'override' });
    expect(describeTypeScript(decision)).toBe(`TypeScript 7.1.0 (--typescript ${overrideDir})`);
    expect(typeScriptWarning(decision)).toContain(SUPPORTED_RANGE);
  });
});

describe('readTypeScriptOverride', () => {
  it('accepts a path to a file inside the package', () => {
    const packageDir = writeTypeScriptPackage(path.join(tmpDir, 'typescript'), '5.5.4');

    expect(readTypeScriptOverride(path.join(packageDir, 'lib', 'typescript.js'))).toEqual({
      packageDir,
      version: '5.5.4',
    });
  });

  it('throws when the path names no typescript package', () => {
    expect(() => readTypeScriptOverride(path.join(tmpDir, 'nope'))).toThrow(
      /does not point at a typescript package/,
    );
  });
});

describe('the supported range', () => {
  it('matches the typescript peer dependency every package publishes', () => {
    ['ts-migrate', 'ts-migrate-server', 'ts-migrate-plugins'].forEach((name) => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.resolve(packageRoot, '..', name, 'package.json'), 'utf-8'),
      );
      expect(packageJson.peerDependencies.typescript).toBe(SUPPORTED_RANGE);
    });
  });
});

describe('reading the invocation from raw argv', () => {
  it('resolves the folder positional of the command', () => {
    const folder = path.join(tmpDir, 'frontend');
    fs.mkdirSync(folder);

    expect(migrationRootFromArgv(['migrate', folder, '--no-inferTypes'], tmpDir)).toBe(folder);
    expect(migrationRootFromArgv(['migrate', '--sources', 'bar/**/*', 'frontend'], tmpDir)).toBe(
      folder,
    );
  });

  it('prefers the directory holding the tsconfig over an option value that names one', () => {
    const folder = path.join(tmpDir, 'frontend');
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'tsconfig.json'), '{}');

    expect(migrationRootFromArgv(['migrate', '--sources', 'frontend/src', 'frontend'], tmpDir)).toBe(
      folder,
    );
  });

  it('skips the --typescript value and falls back to the working directory', () => {
    const overrideDir = path.join(tmpDir, 'vendor');
    fs.mkdirSync(overrideDir);

    expect(migrationRootFromArgv(['migrate', '--typescript', overrideDir], tmpDir)).toBe(tmpDir);
    expect(migrationRootFromArgv(['agents'], tmpDir)).toBe(tmpDir);
  });

  it('reads the --typescript override in either spelling', () => {
    expect(typeScriptOverrideFromArgv(['migrate', '.', '--typescript', '/ts'])).toBe('/ts');
    expect(typeScriptOverrideFromArgv(['migrate', '.', '--typescript=/ts'])).toBe('/ts');
    expect(typeScriptOverrideFromArgv(['migrate', '.'])).toBeUndefined();
  });
});

describe('installTypeScriptResolution', () => {
  // jest resolves modules itself, so the redirect is exercised where it runs
  // in production: a plain node process, before anything requires a compiler.
  function runWithRedirect(packageDir: string): { version: string; subpath: string; same: boolean } {
    const helperPath = path.join(tmpDir, 'resolveTypeScript.js');
    fs.writeFileSync(
      helperPath,
      ts.transpileModule(
        fs.readFileSync(path.join(packageRoot, 'utils', 'resolveTypeScript.ts'), 'utf-8'),
        {
          // The options this package builds with, so the emitted requires
          // match what ships.
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            esModuleInterop: true,
          },
        },
      ).outputText,
    );
    // A second package, with no typescript of its own to resolve.
    const consumerDir = path.join(tmpDir, 'consumer');
    fs.mkdirSync(consumerDir, { recursive: true });
    const consumerPath = path.join(consumerDir, 'plugin.js');
    fs.writeFileSync(consumerPath, `module.exports = require('typescript');\n`);

    const script = `
      require(${JSON.stringify(helperPath)}).installTypeScriptResolution(${JSON.stringify(
        packageDir,
      )});
      const cli = require('typescript');
      const plugin = require(${JSON.stringify(consumerPath)});
      process.stdout.write(JSON.stringify({
        version: cli.version,
        subpath: require('typescript/lib/tsserverlibrary').version,
        same: cli === plugin,
      }));
    `;
    return JSON.parse(
      execFileSync(process.execPath, ['-e', script], { cwd: tmpDir, encoding: 'utf-8' }),
    );
  }

  it('hands every consumer the one compiler it was pointed at', () => {
    installTypeScript(tmpDir, '5.4.5');
    const chosen = writeTypeScriptPackage(path.join(tmpDir, 'vendor', 'typescript'), '5.6.2');

    expect(runWithRedirect(chosen)).toEqual({ version: '5.6.2', subpath: '5.6.2', same: true });
  });
});

describe('cli.ts', () => {
  it('installs the redirect before importing anything that loads a compiler', () => {
    const firstImport = fs
      .readFileSync(path.join(packageRoot, 'cli.ts'), 'utf-8')
      .match(/^import .*$/m);

    expect(firstImport?.[0]).toContain('./utils/useProjectTypeScript');
  });
});
