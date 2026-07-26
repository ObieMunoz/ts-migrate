import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import rename from '../../../commands/rename';
import { createDir, copyDir, deleteDir, getDirData, hashDir } from '@obiemunoz/ts-migrate-test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return mockUpdatableLog();
});

const expectedRenames = [
  { oldFile: 'dir-a/file-2.js', newFile: 'dir-a/file-2.ts' },
  { oldFile: 'dir-a/file-3.jsx', newFile: 'dir-a/file-3.tsx' },
  { oldFile: 'dir-a/file-4.js', newFile: 'dir-a/file-4.tsx' },
  { oldFile: 'dir-a/file-5.js', newFile: 'dir-a/file-5.tsx' },
  { oldFile: 'dir-a/file-6.js', newFile: 'dir-a/file-6.tsx' },
  { oldFile: 'dir-a/file-7.js', newFile: 'dir-a/file-7.tsx' },
  { oldFile: 'dir-a/file-8.mjs', newFile: 'dir-a/file-8.mts' },
  { oldFile: 'dir-a/file-9.cjs', newFile: 'dir-a/file-9.cts' },
  { oldFile: 'file-1.js', newFile: 'file-1.ts' },
];

const sortedRelativeTo = (
  rootDir: string,
  renamedFiles: Array<{ oldFile: string; newFile: string }> | null,
) =>
  renamedFiles
    ?.map(({ oldFile, newFile }) => ({
      oldFile: path.relative(rootDir, oldFile),
      newFile: path.relative(rootDir, newFile),
    }))
    .sort((a, b) => (a.oldFile + a.newFile < b.oldFile + b.newFile ? -1 : 1));

describe('rename command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('Renames JS/JSX/MJS/CJS files to their TypeScript extension', () => {
    const inputDir = path.resolve(__dirname, 'input');
    const outputDir = path.resolve(__dirname, 'output');
    copyDir(inputDir, rootDir);

    const result = rename({ rootDir });

    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual(expectedRenames);
    expect(result?.skippedGitignoredFiles).toBe(0);
  });

  it('Dry run prints the mapping and leaves the tree byte-identical', () => {
    const inputDir = path.resolve(__dirname, 'input');
    copyDir(inputDir, rootDir);
    const hashBefore = hashDir(rootDir);
    const infoSpy = jest.spyOn(log, 'info');

    const result = rename({ rootDir, dryRun: true });

    expect(hashDir(rootDir)).toBe(hashBefore);
    expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual(expectedRenames);

    const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
    expect(infoMessages).toContainEqual(
      expect.stringContaining('9 JS/JSX file(s) would be renamed'),
    );
    // The mapping surfaces each .ts vs .tsx decision.
    expect(infoMessages).toContainEqual(expect.stringContaining('file-1.js -> file-1.ts'));
    expect(infoMessages).toContainEqual(
      expect.stringContaining(`dir-a${path.sep}file-4.js -> dir-a${path.sep}file-4.tsx`),
    );
    expect(infoMessages).toContainEqual(
      expect.stringContaining(`dir-a${path.sep}file-8.mjs -> dir-a${path.sep}file-8.mts`),
    );
    expect(infoMessages).toContainEqual(
      expect.stringContaining('would update allowedImports in'),
    );
    infoSpy.mockRestore();
  });

  describe('gitignored files', () => {
    const setUpGitignoredProject = () => {
      execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
      const writeFile = (relPath: string, text: string) => {
        const filePath = path.resolve(rootDir, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text);
      };
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('.gitignore', 'dist/\n');
      writeFile('src/app.js', 'const a = 1;\n');
      writeFile('dist/bundle.js', 'const b = 2;\n');
    };

    it('skips them by default', () => {
      setUpGitignoredProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(result?.skippedGitignoredFiles).toBe(1);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.js'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.ts'))).toBe(false);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Skipping 1 gitignored JS/JSX file(s) (dist/bundle.js)'),
      );
      infoSpy.mockRestore();
    });

    it('renames them with gitignore disabled', () => {
      setUpGitignoredProject();

      const result = rename({ rootDir, gitignore: false });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `dist${path.sep}bundle.js`, newFile: `dist${path.sep}bundle.ts` },
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(result?.skippedGitignoredFiles).toBe(0);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.ts'))).toBe(true);
    });
  });

  describe('.mjs and .cjs files', () => {
    const setUpModuleProject = () => {
      const writeFile = (relPath: string, text: string) => {
        const filePath = path.resolve(rootDir, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text);
      };
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('package.json', JSON.stringify({ type: 'module' }));
      writeFile('postcss.config.cjs', 'module.exports = {};\n');
      writeFile('eslint.config.mjs', 'export default [];\n');
      writeFile('src/task.mjs', 'export const task = 1;\n');
      writeFile('src/helper.cjs', 'module.exports = {};\n');
      writeFile('src/Widget.mjs', "import React from 'react';\nexport const W = () => <div />;\n");
    };

    const skippedRelativeTo = (result: ReturnType<typeof rename>) =>
      result?.skippedModuleFiles
        .map(({ file, reason }) => ({ file: path.relative(rootDir, file), reason }))
        .sort((a, b) => (a.file < b.file ? -1 : 1));

    it('keeps config shims and JSX modules at their extension, with bootstrap off', () => {
      setUpModuleProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir, bootstrap: false });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `src${path.sep}helper.cjs`, newFile: `src${path.sep}helper.cts` },
        { oldFile: `src${path.sep}task.mjs`, newFile: `src${path.sep}task.mts` },
      ]);
      expect(skippedRelativeTo(result)).toEqual([
        {
          file: 'eslint.config.mjs',
          reason: 'config file loaded by name, which .mts would break',
        },
        {
          file: 'postcss.config.cjs',
          reason: 'config file loaded by name, which .cts would break',
        },
        {
          file: `src${path.sep}Widget.mjs`,
          reason: 'contains JSX, which .mts cannot hold',
        },
      ]);
      expect(fs.existsSync(path.resolve(rootDir, 'postcss.config.cjs'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'eslint.config.mjs'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'src/Widget.mjs'))).toBe(true);

      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Keeping 3 .mjs/.cjs file(s) at their current extension'),
      );
      expect(infoMessages).toContainEqual(expect.stringContaining('postcss.config.cjs'));
      infoSpy.mockRestore();
    });

    it('leaves config shims to the bootstrap partition by default', () => {
      setUpModuleProject();

      const result = rename({ rootDir });

      expect(
        result?.skippedBootstrapFiles.map(({ file }) => path.relative(rootDir, file)).sort(),
      ).toEqual(['eslint.config.mjs', 'postcss.config.cjs']);
      expect(skippedRelativeTo(result)).toEqual([
        {
          file: `src${path.sep}Widget.mjs`,
          reason: 'contains JSX, which .mts cannot hold',
        },
      ]);
    });
  });

  describe('build system files', () => {
    const setUpBootstrapProject = () => {
      const writeFile = (relPath: string, text: string) => {
        const filePath = path.resolve(rootDir, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text);
      };
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('package.json', JSON.stringify({ scripts: { build: 'node scripts/build.js' } }));
      writeFile('webpack.config.js', "const paths = require('./config/paths');\n");
      writeFile('config/paths.js', 'module.exports = {};\n');
      writeFile('scripts/build.js', "require('../webpack.config');\n");
      writeFile('src/app.js', 'const a = 1;\n');
    };

    it('keeps them as JavaScript by default', () => {
      setUpBootstrapProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(fs.existsSync(path.resolve(rootDir, 'webpack.config.js'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'config/paths.js'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'scripts/build.js'))).toBe(true);
      expect(
        result?.skippedBootstrapFiles
          .map(({ file, reason }) => ({ file: path.relative(rootDir, file), reason }))
          .sort((a, b) => (a.file < b.file ? -1 : 1)),
      ).toEqual([
        { file: `config${path.sep}paths.js`, reason: 'required by webpack.config.js' },
        {
          file: `scripts${path.sep}build.js`,
          reason: 'run with node by the "build" script in package.json',
        },
        { file: 'webpack.config.js', reason: 'config file next to a package.json' },
      ]);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Keeping 3 build system file(s) as JavaScript'),
      );
      expect(infoMessages).toContainEqual(expect.stringContaining('--bootstrap=false'));
      infoSpy.mockRestore();
    });

    it('renames them with bootstrap disabled', () => {
      setUpBootstrapProject();

      const result = rename({ rootDir, bootstrap: false });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `config${path.sep}paths.js`, newFile: `config${path.sep}paths.ts` },
        { oldFile: `scripts${path.sep}build.js`, newFile: `scripts${path.sep}build.ts` },
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
        { oldFile: 'webpack.config.js', newFile: 'webpack.config.ts' },
      ]);
      expect(result?.skippedBootstrapFiles).toEqual([]);
    });

    it('honors a tsconfig exclude entry as the per-file override', () => {
      setUpBootstrapProject();
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ include: ['./**/*'], exclude: ['src/app.js'] }),
      );

      const result = rename({ rootDir });

      expect(result?.renamedFiles).toEqual([]);
      expect(fs.existsSync(path.resolve(rootDir, 'src/app.js'))).toBe(true);
    });

    it('leaves a node script path in package.json alone', () => {
      setUpBootstrapProject();

      rename({ rootDir });

      expect(JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'))).toEqual({
        scripts: { build: 'node scripts/build.js' },
      });
    });

    it('keeps a config split per environment, and the script that names it', () => {
      const writeFile = (relPath: string, text: string) => {
        const filePath = path.resolve(rootDir, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text);
      };
      const build = 'rm -rf build && webpack --config webpack.config.production.js --progress';
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('package.json', JSON.stringify({ scripts: { build } }));
      writeFile('webpack.config.js', 'module.exports = {};\n');
      writeFile('webpack.config.production.js', 'module.exports = {};\n');
      writeFile('src/app.js', 'const a = 1;\n');

      const result = rename({ rootDir });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(fs.existsSync(path.resolve(rootDir, 'webpack.config.production.js'))).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8')).scripts.build,
      ).toBe(build);
    });

    it('repoints it once --bootstrap=false renames the target', () => {
      setUpBootstrapProject();

      rename({ rootDir, bootstrap: false });

      expect(JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'))).toEqual({
        scripts: { build: 'node scripts/build.ts' },
      });
    });
  });

  describe('package.json references', () => {
    const writeFile = (relPath: string, text: string) => {
      const filePath = path.resolve(rootDir, relPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text);
    };
    const readPackageJson = () => fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8');

    const packageJsonText = `{
  "name": "demo",
  "main": "src/index.js",
  "bin": {
    "demo": "src/cli.js"
  },
  "exports": {
    ".": "./src/index.js"
  },
  "files": ["src"],
  "scripts": {
    "build": "node scripts/build.js",
    "lint": "eslint .",
    "test": "mocha 'test/**/*.test.js'",
    "coverage": "nyc --reporter=text mocha test/unit.test.js"
  },
  "jest": {
    "testMatch": ["**/*.spec.js"],
    "setupFiles": ["<rootDir>/jest.setup.js"]
  }
}
`;

    const setUpProject = () => {
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('package.json', packageJsonText);
      writeFile('scripts/build.js', 'console.log(1);\n');
      writeFile('jest.setup.js', 'global.x = 1;\n');
      writeFile('src/index.js', 'const a = 1;\n');
      writeFile('src/cli.js', 'const b = 2;\n');
      writeFile('src/util.spec.js', 'const c = 3;\n');
      writeFile('test/unit.test.js', 'const d = 4;\n');
    };

    it('repoints script paths and test globs, and preserves the formatting', () => {
      setUpProject();

      const result = rename({ rootDir });

      expect(readPackageJson()).toBe(
        packageJsonText
          .replace("mocha 'test/**/*.test.js'", "mocha 'test/**/*.test.ts'")
          .replace('mocha test/unit.test.js', 'mocha test/unit.test.ts')
          .replace('"**/*.spec.js"', '"**/*.spec.ts"')
          .replace('"<rootDir>/jest.setup.js"', '"<rootDir>/jest.setup.ts"'),
      );
      expect(result?.packageJsonRewrites.map(({ key, to }) => ({ key, to }))).toEqual([
        { key: 'scripts.test', to: "mocha 'test/**/*.test.ts'" },
        { key: 'scripts.coverage', to: 'nyc --reporter=text mocha test/unit.test.ts' },
        { key: 'jest.testMatch[0]', to: '**/*.spec.ts' },
        { key: 'jest.setupFiles[0]', to: '<rootDir>/jest.setup.ts' },
      ]);
    });

    it('reports main and bin instead of rewriting them', () => {
      setUpProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir });

      expect(readPackageJson()).toContain('"main": "src/index.js"');
      expect(readPackageJson()).toContain('"demo": "src/cli.js"');
      expect(readPackageJson()).toContain('".": "./src/index.js"');
      expect(result?.packageJsonNotices).toEqual([
        { file: 'package.json', key: 'main', value: 'src/index.js', target: 'src/index.ts' },
        { file: 'package.json', key: 'bin.demo', value: 'src/cli.js', target: 'src/cli.ts' },
        {
          file: 'package.json',
          key: 'exports["."]',
          value: './src/index.js',
          target: 'src/index.ts',
        },
      ]);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Left 3 package.json entry point(s) alone'),
      );
      expect(infoMessages).toContainEqual(expect.stringContaining('need to name build output'));
      infoSpy.mockRestore();
    });

    it('writes nothing during a dry run', () => {
      setUpProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir, dryRun: true });

      expect(readPackageJson()).toBe(packageJsonText);
      expect(result?.packageJsonRewrites.map(({ key }) => key)).toEqual([
        'scripts.test',
        'scripts.coverage',
        'jest.testMatch[0]',
        'jest.setupFiles[0]',
      ]);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Dry run: would update 4 package.json reference(s)'),
      );
      infoSpy.mockRestore();
    });

    it('widens a glob that still matches unmigrated files', () => {
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'], exclude: ['legacy'] }));
      writeFile('package.json', JSON.stringify({ scripts: { test: 'mocha "**/*.test.js"' } }));
      writeFile('src/a.test.js', 'const a = 1;\n');
      writeFile('legacy/b.test.js', 'const b = 2;\n');

      const result = rename({ rootDir });

      expect(fs.existsSync(path.resolve(rootDir, 'legacy/b.test.js'))).toBe(true);
      expect(result?.packageJsonRewrites.map(({ key, to }) => ({ key, to }))).toEqual([
        { key: 'scripts.test', to: 'mocha "**/*.test.{js,ts}"' },
      ]);
    });

    it('widens a glob whose matches renamed to more than one extension', () => {
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('package.json', JSON.stringify({ jest: { testMatch: ['**/*.test.js'] } }));
      writeFile('src/a.test.js', 'const a = 1;\n');
      writeFile(
        'src/Widget.test.js',
        "import React from 'react';\nexport const W = () => <div />;\n",
      );

      const result = rename({ rootDir });

      expect(result?.packageJsonRewrites.map(({ key, to }) => ({ key, to }))).toEqual([
        { key: 'jest.testMatch[0]', to: '**/*.test.{ts,tsx}' },
      ]);
    });

    it('leaves a glob alone when the rename matched none of it', () => {
      writeFile('tsconfig.json', JSON.stringify({ include: ['src/**/*'] }));
      writeFile('package.json', JSON.stringify({ scripts: { test: 'mocha "test/**/*.js"' } }));
      writeFile('src/a.js', 'const a = 1;\n');
      writeFile('test/b.js', 'const b = 2;\n');

      const result = rename({ rootDir });

      expect(result?.packageJsonRewrites).toEqual([]);
      expect(JSON.parse(readPackageJson()).scripts.test).toBe('mocha "test/**/*.js"');
    });
  });
});
