import fs from 'fs';
import path from 'path';
import { partitionBootstrapFiles } from '../../utils/bootstrapFiles';
import { detectBundler } from '../../utils/bundler';
import { CONFIG_EXTENSIONS, isConfigName, isToolConfigFile } from '../../utils/configNames';
import { createDir, deleteDir } from '@obiemunoz/ts-migrate-test-utils';

jest.mock('updatable-log', () => {
  const { mockUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return mockUpdatableLog();
});

describe('isConfigName', () => {
  it('reads a config split per environment as a config', () => {
    expect(isConfigName('webpack.config')).toBe(true);
    expect(isConfigName('webpack.config.production')).toBe(true);
    expect(isConfigName('webpack.dev.config')).toBe(true);
    expect(isConfigName('jest.config.integration')).toBe(true);
    expect(isConfigName('karma.conf')).toBe(true);
  });

  it('leaves a name that merely spells the word alone', () => {
    expect(isConfigName('config')).toBe(false);
    expect(isConfigName('conf')).toBe(false);
    expect(isConfigName('myconfig')).toBe(false);
    expect(isConfigName('app.configure')).toBe(false);
  });
});

describe('isToolConfigFile', () => {
  it('takes the tool from the first segment and leaves the suffix open', () => {
    expect(isToolConfigFile('webpack.config.js', 'webpack')).toBe(true);
    expect(isToolConfigFile('webpack.config.production.js', 'webpack')).toBe(true);
    expect(isToolConfigFile('webpack.dev.config.ts', 'webpack')).toBe(true);
    expect(isToolConfigFile('vite.config.mts', 'vite')).toBe(true);
    expect(isToolConfigFile('webpack.config.js', 'vite')).toBe(false);
    expect(isToolConfigFile('webpack.dev.js', 'webpack')).toBe(false);
  });

  it('reads the TypeScript spelling of every JavaScript extension', () => {
    expect(CONFIG_EXTENSIONS).toEqual(['js', 'ts', 'jsx', 'tsx', 'cjs', 'cts', 'mjs', 'mts']);
    CONFIG_EXTENSIONS.forEach((extension) => {
      expect(isToolConfigFile(`vite.config.${extension}`, 'vite')).toBe(true);
    });
    expect(isToolConfigFile('vite.config.json', 'vite')).toBe(false);
  });
});

// The two utilities answered this with separate rules and disagreed about a
// config split per environment: the bundler detector matched it and the
// bootstrap partition did not, so the same file was evidence of a webpack
// project and a file to rename.
describe('bootstrap detection and bundler detection', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('agree about a config split per environment', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(rootDir, 'webpack.config.production.js'), 'module.exports = {};\n');
    const file = path.resolve(rootDir, 'webpack.config.production.js');

    expect(detectBundler(rootDir, null)).toEqual({
      name: 'webpack',
      evidence: 'webpack.config.production.js',
    });
    expect(partitionBootstrapFiles(rootDir, [file]).bootstrap).toEqual([
      { file, reason: 'config file next to a package.json' },
    ]);
  });
});
