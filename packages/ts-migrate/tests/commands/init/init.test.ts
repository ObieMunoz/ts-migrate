import fs from 'fs';
import path from 'path';
import init from '../../../commands/init';
import { createDir, deleteDir } from '../../test-utils';

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
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('creates a migration-friendly tsconfig.json without a local typescript install', () => {
    init({ rootDir, isExtendedConfig: false });

    const config = readConfig(rootDir);
    expect(config.compilerOptions).toMatchObject({
      module: 'commonjs',
      moduleDetection: 'force',
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

  it('ignores an unparseable package.json', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), 'not json');

    init({ rootDir, isExtendedConfig: false });

    expect(readConfig(rootDir).compilerOptions.module).toBe('commonjs');
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
