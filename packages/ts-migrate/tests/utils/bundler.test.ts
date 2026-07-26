import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectBundler, hasViteClientTypes } from '../../utils/bundler';
import { deleteDir } from '@obiemunoz/ts-migrate-test-utils';

// An OS temp dir rather than one inside this repo: hasViteClientTypes walks
// the project's ancestors, and the workspace's own node_modules would answer
// for a fixture that installed nothing.
const createDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-bundler-'));

describe('detectBundler', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('finds a bundler declared in devDependencies', () => {
    expect(detectBundler(rootDir, { devDependencies: { vite: '^5.0.0' } })).toEqual({
      name: 'vite',
      evidence: '"vite" in devDependencies',
    });
    expect(detectBundler(rootDir, { dependencies: { webpack: '^5.0.0' } })).toEqual({
      name: 'webpack',
      evidence: '"webpack" in dependencies',
    });
  });

  it('reads react-scripts as webpack, which is what Create React App builds with', () => {
    expect(detectBundler(rootDir, { dependencies: { 'react-scripts': '5.0.1' } })).toEqual({
      name: 'webpack',
      evidence: '"react-scripts" in dependencies',
    });
  });

  it('names webpack itself when a project declares both', () => {
    expect(
      detectBundler(rootDir, {
        devDependencies: { webpack: '^5.0.0' },
        dependencies: { 'react-scripts': '5.0.1' },
      }),
    ).toEqual({ name: 'webpack', evidence: '"webpack" in devDependencies' });
  });

  it('finds a bundler from a config file at the project root', () => {
    fs.writeFileSync(path.join(rootDir, 'webpack.config.dev.js'), 'module.exports = {};\n');

    expect(detectBundler(rootDir, null)).toEqual({
      name: 'webpack',
      evidence: 'webpack.config.dev.js',
    });
  });

  it('takes the config file extension from the set a bundler loads', () => {
    fs.writeFileSync(path.join(rootDir, 'vite.config.mts'), 'export default {};\n');

    expect(detectBundler(rootDir, null)?.name).toBe('vite');
  });

  it('ignores a name that only looks like a config file', () => {
    fs.writeFileSync(path.join(rootDir, 'vite.config.json'), '{}\n');
    fs.writeFileSync(path.join(rootDir, 'webpack.config.md'), '# notes\n');

    expect(detectBundler(rootDir, null)).toBeNull();
  });

  it('reports vite for a project holding both', () => {
    fs.writeFileSync(path.join(rootDir, 'webpack.config.js'), 'module.exports = {};\n');

    expect(detectBundler(rootDir, { devDependencies: { vite: '^5.0.0' } })?.name).toBe('vite');
  });

  it('returns null without evidence', () => {
    expect(detectBundler(rootDir, null)).toBeNull();
    expect(detectBundler(rootDir, { devDependencies: { jest: '^29.0.0' } })).toBeNull();
  });
});

describe('hasViteClientTypes', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  const writeViteClient = (dir: string) => {
    const viteDir = path.join(dir, 'node_modules', 'vite');
    fs.mkdirSync(viteDir, { recursive: true });
    fs.writeFileSync(path.join(viteDir, 'client.d.ts'), 'interface ImportMetaEnv {}\n');
  };

  it('finds the file hoisted to an ancestor node_modules', () => {
    const appDir = path.join(rootDir, 'packages', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    writeViteClient(rootDir);

    expect(hasViteClientTypes(appDir)).toBe(true);
  });

  it('ignores an install above the repository boundary', () => {
    writeViteClient(rootDir);
    const repoDir = path.join(rootDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    expect(hasViteClientTypes(repoDir)).toBe(false);
  });

  it('is false when vite is not installed', () => {
    expect(hasViteClientTypes(rootDir)).toBe(false);
  });
});
