import fs from 'fs';
import os from 'os';
import path from 'path';
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
      strict: true,
      skipLibCheck: true,
    });
    // These recent `tsc --init` defaults block @types packages and flood a
    // freshly-converted CommonJS project with suppressions.
    expect(config.compilerOptions.types).toBeUndefined();
    expect(config.compilerOptions.verbatimModuleSyntax).toBeUndefined();
  });

  it('uses nodenext module settings when package.json declares an ESM package', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ type: 'module' }));

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.module).toBe('nodenext');
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
