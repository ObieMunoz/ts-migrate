import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import log from 'updatable-log';
import init from '../../../commands/init';
import { deleteDir } from '../../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../../test-utils');
  return mockUpdatableLog();
});

// The generated tsconfig may contain // comments.
function readConfig(rootDir: string) {
  const raw = fs.readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf-8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

/** A vite install holding only what `types: ["vite/client"]` resolves to. */
function installVite(rootDir: string) {
  const viteDir = path.join(rootDir, 'node_modules', 'vite');
  fs.mkdirSync(viteDir, { recursive: true });
  fs.writeFileSync(
    path.join(viteDir, 'package.json'),
    JSON.stringify({
      name: 'vite',
      version: '5.4.0',
      exports: { './client': { types: './client.d.ts' }, './package.json': './package.json' },
    }),
  );
  fs.writeFileSync(
    path.join(viteDir, 'client.d.ts'),
    `interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
`,
  );
}

/** Type-checks rootDir with the generated tsconfig, the way the project would. */
function typeCheck(rootDir: string): string[] {
  const configFile = path.join(rootDir, 'tsconfig.json');
  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, rootDir, undefined, configFile);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return `TS${diagnostic.code}: ${message}`;
  });
}

describe('init command', () => {
  let rootDir: string;

  beforeEach(() => {
    // An OS temp dir rather than one inside this repo: init scans the
    // project directory and its ancestors for node_modules/@types, and the
    // workspace's own @types packages would leak into the generated config.
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-init-'));
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('creates a migration-friendly tsconfig.json without a local typescript install', () => {
    init({ rootDir, isExtendedConfig: false });

    const config = readConfig(rootDir);
    expect(config.compilerOptions).toMatchObject({
      target: 'esnext',
      module: 'commonjs',
      moduleDetection: 'force',
      jsx: 'react',
      esModuleInterop: true,
      resolveJsonModule: true,
      strict: true,
      skipLibCheck: true,
    });
    // These recent `tsc --init` defaults block @types packages and flood a
    // freshly-converted CommonJS project with suppressions.
    expect(config.compilerOptions.types).toBeUndefined();
    expect(config.compilerOptions.verbatimModuleSyntax).toBeUndefined();
    // Left to the module setting, as it was before bundler detection existed.
    expect(config.compilerOptions.moduleResolution).toBeUndefined();
    // No git repository here, so the built-in exclude defaults stay implicit.
    expect(config.exclude).toBeUndefined();
  });

  it('excludes gitignored directories, keeping the defaults an explicit exclude replaces', () => {
    execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(rootDir, '.gitignore'), 'dist/\ncoverage/\n');
    fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'dist/bundle.js'), '');
    fs.mkdirSync(path.join(rootDir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'coverage/lcov.info'), '');
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src/app.js'), '');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).exclude).toEqual([
      'node_modules',
      'bower_components',
      'jspm_packages',
      'coverage',
      'dist',
    ]);
  });

  it('excludes only directories matching an ignore pattern, never a parent that merely contains them', () => {
    execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(rootDir, '.gitignore'), 'dist/\n');
    // src/frontend holds nothing but ignored output right now; git status
    // would collapse it, but new source files could appear there any day.
    fs.mkdirSync(path.join(rootDir, 'src/frontend/dist/express'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src/frontend/dist/express/bundle.js'), '');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).exclude).toEqual([
      'node_modules',
      'bower_components',
      'jspm_packages',
      'src/frontend/dist',
    ]);
  });

  it('excludes detected build system files so they stay JavaScript', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node scripts/build.js' } }),
    );
    fs.writeFileSync(
      path.join(rootDir, 'webpack.config.js'),
      "const paths = require('./config/paths');\n",
    );
    fs.mkdirSync(path.join(rootDir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'config/paths.js'), 'module.exports = {};\n');
    fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'scripts/build.js'), "require('../webpack.config');\n");
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src/app.js'), '');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).exclude).toEqual([
      'node_modules',
      'bower_components',
      'jspm_packages',
      'config/paths.js',
      'scripts/build.js',
      'webpack.config.js',
    ]);
  });

  it('lists gitignored directories and build system files in one exclude', () => {
    execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(rootDir, '.gitignore'), 'dist/\n');
    fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'dist/bundle.js'), '');
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(rootDir, 'jest.config.js'), 'module.exports = {};\n');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).exclude).toEqual([
      'node_modules',
      'bower_components',
      'jspm_packages',
      'dist',
      'jest.config.js',
    ]);
  });

  it('uses nodenext module settings when package.json declares an ESM package', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ type: 'module' }));

    init({ rootDir, isExtendedConfig: false });

    const { compilerOptions } = readConfig(rootDir);
    expect(compilerOptions.module).toBe('nodenext');
    expect(compilerOptions.moduleResolution).toBeUndefined();
  });

  it('uses bundler module settings and pins vite/client for a Vite project', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.4.0' } }),
    );
    installVite(rootDir);

    init({ rootDir, isExtendedConfig: false });

    const { compilerOptions } = readConfig(rootDir);
    expect(compilerOptions.module).toBe('esnext');
    expect(compilerOptions.moduleResolution).toBe('bundler');
    expect(compilerOptions.types).toEqual(['vite/client']);
  });

  it('type-checks import.meta.env with the config it writes for a Vite project', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.4.0' } }),
    );
    installVite(rootDir);
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src/icon.svg'), '<svg />\n');
    fs.writeFileSync(
      path.join(rootDir, 'src/app.ts'),
      "import icon from './icon.svg';\n\nexport const mode = import.meta.env.MODE;\nexport const logo = icon;\n",
    );

    init({ rootDir, isExtendedConfig: false });

    // Without the bundler settings this is TS1343 for import.meta plus a
    // TS2307 for the asset import, both of which migrate into suppressions.
    expect(typeCheck(rootDir)).toEqual([]);
  }, 60000);

  it('prefers the bundler module setting over the ESM one', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ type: 'module', devDependencies: { vite: '^5.4.0' } }),
    );

    init({ rootDir, isExtendedConfig: false });

    const { compilerOptions } = readConfig(rootDir);
    expect(compilerOptions.module).toBe('esnext');
    expect(compilerOptions.moduleResolution).toBe('bundler');
    // vite is declared but not installed, so nothing would resolve the entry.
    expect(compilerOptions.types).toBeUndefined();
  });

  it('detects a bundler from its config file alone', () => {
    fs.writeFileSync(path.join(rootDir, 'vite.config.ts'), 'export default {};\n');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.moduleResolution).toBe('bundler');
  });

  it('recommends @types/webpack-env for a webpack project without it', () => {
    const warn = jest.spyOn(log, 'warn');
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ devDependencies: { webpack: '^5.90.0' } }),
    );

    init({ rootDir, isExtendedConfig: false });

    const { compilerOptions } = readConfig(rootDir);
    expect(compilerOptions.module).toBe('esnext');
    expect(compilerOptions.moduleResolution).toBe('bundler');
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
      '@types/webpack-env',
    );
    warn.mockRestore();
  });

  it('pins an installed @types/webpack-env instead of recommending it', () => {
    const warn = jest.spyOn(log, 'warn');
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ devDependencies: { webpack: '^5.90.0' } }),
    );
    const typesDir = path.join(rootDir, 'node_modules', '@types', 'webpack-env');
    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(
      path.join(typesDir, 'package.json'),
      JSON.stringify({ name: '@types/webpack-env' }),
    );

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.types).toEqual(['webpack-env']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the automatic JSX runtime for React 17+ projects', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.2.0' } }),
    );

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.jsx).toBe('react-jsx');
  });

  it('keeps the classic JSX transform for pre-17 React projects', () => {
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '~16.14.0' } }),
    );

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.jsx).toBe('react');
  });

  it('ignores an unparseable package.json', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), 'not json');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.module).toBe('commonjs');
  });

  it('pins installed @types packages in the "types" array', () => {
    const typesDir = path.join(rootDir, 'node_modules', '@types');
    const addTypesPackage = (name: string, packageJson?: Record<string, unknown>) => {
      fs.mkdirSync(path.join(typesDir, name), { recursive: true });
      if (packageJson) {
        fs.writeFileSync(path.join(typesDir, name, 'package.json'), JSON.stringify(packageJson));
      }
    };
    addTypesPackage('node', { name: '@types/node' });
    addTypesPackage('mocha', { name: '@types/mocha' });
    // A stub for a library that ships its own types; the compiler's
    // automatic inclusion skips these.
    addTypesPackage('json5', { name: '@types/json5', typings: null });
    addTypesPackage('.cache');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.types).toEqual(['mocha', 'node']);
  });

  it('pins @types packages hoisted to an ancestor node_modules', () => {
    const appDir = path.join(rootDir, 'packages', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    const reactDir = path.join(rootDir, 'node_modules', '@types', 'react');
    fs.mkdirSync(reactDir, { recursive: true });
    fs.writeFileSync(path.join(reactDir, 'package.json'), JSON.stringify({ name: '@types/react' }));

    init({ rootDir: appDir, isExtendedConfig: false });

    expect(readConfig(appDir).compilerOptions.types).toEqual(['react']);
  });

  it('ignores @types packages above the repository boundary', () => {
    // A stray install outside the repo resolves on this machine only;
    // pinning it would be a hard TS2688 on any other checkout.
    const strayDir = path.join(rootDir, 'node_modules', '@types', 'stray');
    fs.mkdirSync(strayDir, { recursive: true });
    fs.writeFileSync(path.join(strayDir, 'package.json'), JSON.stringify({ name: '@types/stray' }));
    const repoDir = path.join(rootDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    const nodeDir = path.join(repoDir, 'node_modules', '@types', 'node');
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(path.join(nodeDir, 'package.json'), JSON.stringify({ name: '@types/node' }));

    init({ rootDir: repoDir, isExtendedConfig: false });

    expect(readConfig(repoDir).compilerOptions.types).toEqual(['node']);
  });

  it('skips dangling @types symlinks like the compiler does', () => {
    const typesDir = path.join(rootDir, 'node_modules', '@types');
    fs.mkdirSync(path.join(typesDir, 'node'), { recursive: true });
    fs.writeFileSync(
      path.join(typesDir, 'node', 'package.json'),
      JSON.stringify({ name: '@types/node' }),
    );
    fs.symlinkSync(path.join(rootDir, 'nowhere'), path.join(typesDir, 'gone'));

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.types).toEqual(['node']);
  });

  it('does not overwrite an existing tsconfig.json', () => {
    const configFile = path.join(rootDir, 'tsconfig.json');
    fs.writeFileSync(configFile, '{ "custom": true }');

    init({ rootDir, isExtendedConfig: false });

    expect(fs.readFileSync(configFile, 'utf-8')).toBe('{ "custom": true }');
  });

  it('writes the extended config when requested', () => {
    init({ rootDir, isExtendedConfig: true });

    const raw = fs.readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf-8');
    expect(raw).toContain('"extends": "../typescript/tsconfig.base.json"');
  });
});
