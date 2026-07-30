import fs from 'fs';
import path from 'path';
import { eslintTypeScriptSupport, hasTypeScriptBuild } from '../../utils/projectTooling';
import { createTmpDir, deleteDir } from '@obiemunoz/ts-migrate-test-utils';

let rootDir: string;

beforeEach(() => {
  // Outside the repository: both checks walk the project's ancestors, and this
  // repository's own package.json and ESLint config would answer for a fixture.
  rootDir = createTmpDir('ts-migrate-tooling-');
  // The boundary the walk stops at, so nothing above the fixture answers.
  fs.mkdirSync(path.join(rootDir, '.git'));
});

afterEach(() => {
  deleteDir(rootDir);
});

const writeManifest = (manifest: unknown, dir = rootDir) =>
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

describe('hasTypeScriptBuild', () => {
  it('is false for the project the migration leaves behind', () => {
    writeManifest({ name: 'demo', scripts: { test: 'jest', lint: 'eslint .' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });

  it('is false with no package.json at all', () => {
    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });

  it('finds a compiler in a script', () => {
    writeManifest({ scripts: { build: 'tsc -p tsconfig.build.json' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('finds a compiler invoked through its installed path', () => {
    writeManifest({ scripts: { build: './node_modules/.bin/tsc --build' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('finds a runner loaded into node', () => {
    writeManifest({ scripts: { start: 'node -r ts-node/register src/index.ts' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('finds node running TypeScript itself', () => {
    writeManifest({ scripts: { start: 'node --experimental-strip-types src/index.ts' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('reads through the package manager and the env wrapper in front of the command', () => {
    writeManifest({ scripts: { dev: 'cross-env NODE_ENV=development npx tsx watch src' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('takes the emitting half of a chained script', () => {
    writeManifest({ scripts: { build: 'tsc --noEmit && vite build' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('does not read a type check as a build step', () => {
    writeManifest({ scripts: { typecheck: 'tsc --noEmit', lint: 'eslint . && tsc --noEmit' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });

  it('finds a declared toolchain whose script is somewhere it cannot read', () => {
    writeManifest({ scripts: { build: 'make dist' }, devDependencies: { vite: '^5.0.0' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('reads a loader as the evidence for a bundler that needs one', () => {
    writeManifest({ scripts: { build: 'webpack' }, devDependencies: { webpack: '^5.0.0' } });
    expect(hasTypeScriptBuild(rootDir)).toBe(false);

    writeManifest({
      scripts: { build: 'webpack' },
      devDependencies: { webpack: '^5.0.0', 'ts-loader': '^9.0.0' },
    });
    expect(hasTypeScriptBuild(rootDir)).toBe(true);
  });

  it('does not read typescript itself as a build step', () => {
    writeManifest({ devDependencies: { typescript: '^5.7.3' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });

  it('ignores a name that only contains a command name', () => {
    writeManifest({ scripts: { build: 'node scripts/next/build.js && typedoc' } });

    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });

  it('finds the build script of a monorepo root above the folder', () => {
    const folder = path.join(rootDir, 'packages', 'app');
    fs.mkdirSync(folder, { recursive: true });
    writeManifest({ scripts: { build: 'tsc --build' } });
    writeManifest({ name: 'app' }, folder);

    expect(hasTypeScriptBuild(folder)).toBe(true);
  });

  it('stops at the repository root', () => {
    const repoDir = path.join(rootDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    writeManifest({ scripts: { build: 'tsc' } });
    writeManifest({ name: 'repo' }, repoDir);

    expect(hasTypeScriptBuild(repoDir)).toBe(false);
  });

  it('survives an unparseable package.json', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{ "scripts": ');

    expect(hasTypeScriptBuild(rootDir)).toBe(false);
  });
});

describe('eslintTypeScriptSupport', () => {
  it('reports a project that does not lint at all', () => {
    writeManifest({ name: 'demo' });

    expect(eslintTypeScriptSupport(rootDir)).toBe('no-eslint');
  });

  it('reports ESLint declared without the TypeScript parser', () => {
    writeManifest({ devDependencies: { eslint: '^8.57.0' } });

    expect(eslintTypeScriptSupport(rootDir)).toBe('javascript-only');
  });

  it('reports a config file with no TypeScript in it', () => {
    fs.writeFileSync(path.join(rootDir, '.eslintrc.json'), '{ "extends": "airbnb-base" }\n');

    expect(eslintTypeScriptSupport(rootDir)).toBe('javascript-only');
  });

  it('finds the parser and plugin in devDependencies', () => {
    writeManifest({
      devDependencies: { eslint: '^8.57.0', '@typescript-eslint/parser': '^7.0.0' },
    });

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('finds the umbrella package of the flat config era', () => {
    writeManifest({ devDependencies: { eslint: '^9.0.0', 'typescript-eslint': '^8.0.0' } });

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('finds a shared config that brings the parser without naming it', () => {
    writeManifest({
      devDependencies: { eslint: '^8.57.0', 'eslint-config-airbnb-typescript': '^18.0.0' },
    });

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('reads a flat config that imports the plugin', () => {
    writeManifest({ devDependencies: { eslint: '^9.0.0' } });
    fs.writeFileSync(
      path.join(rootDir, 'eslint.config.mjs'),
      "import tseslint from 'typescript-eslint';\nexport default tseslint.configs.recommended;\n",
    );

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('reads an eslintrc that names the parser', () => {
    fs.writeFileSync(
      path.join(rootDir, '.eslintrc'),
      '{ "parser": "@typescript-eslint/parser" }\n',
    );

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('reads the eslintConfig block of a package.json', () => {
    writeManifest({
      devDependencies: { eslint: '^8.57.0' },
      eslintConfig: { extends: ['plugin:@typescript-eslint/recommended'] },
    });

    expect(eslintTypeScriptSupport(rootDir)).toBe('typescript');
  });

  it('finds the config of a monorepo root above the folder', () => {
    const folder = path.join(rootDir, 'packages', 'app');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'eslint.config.js'),
      "module.exports = [require('typescript-eslint').configs.base];\n",
    );
    writeManifest({ name: 'app' }, folder);

    expect(eslintTypeScriptSupport(folder)).toBe('typescript');
  });
});
