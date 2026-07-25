import fs from 'fs';
import os from 'os';
import path from 'path';
import { BundlerDetection } from '../../utils/bundler';
import { detectPathAliases, renderPathAliases } from '../../utils/pathAliases';
import { deleteDir } from '../test-utils';

const webpack: BundlerDetection = { name: 'webpack', evidence: 'webpack.config.js' };
const vite: BundlerDetection = { name: 'vite', evidence: 'vite.config.js' };

describe('detectPathAliases', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-aliases-'));
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  const writeFile = (relPath: string, text: string) => {
    const filePath = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  };

  const makeDir = (relPath: string) => {
    fs.mkdirSync(path.join(rootDir, relPath), { recursive: true });
  };

  const writeConfig = (body: string, file = 'webpack.config.js') => {
    writeFile(file, `const path = require('path');\n\nmodule.exports = ${body};\n`);
  };

  describe('resolve.modules', () => {
    it('reads a directory joined onto __dirname', () => {
      makeDir('src');
      writeConfig("{ resolve: { modules: [path.join(__dirname, 'src'), 'node_modules'] } }");

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        paths: { '*': ['./src/*'] },
        source: 'webpack.config.js',
        skipped: [],
      });
    });

    it('reads path.resolve and a plain relative entry the same way', () => {
      makeDir('app');
      writeConfig("{ resolve: { modules: [path.resolve(__dirname, 'app')] } }");
      expect(detectPathAliases(rootDir, webpack)).toMatchObject({ paths: { '*': ['./app/*'] } });

      writeConfig("{ resolve: { modules: ['app', 'node_modules'] } }");
      expect(detectPathAliases(rootDir, webpack)).toMatchObject({ paths: { '*': ['./app/*'] } });
    });

    it('reads a template literal', () => {
      makeDir('src');
      writeConfig('{ resolve: { modules: [`${__dirname}/src`] } }');

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({ paths: { '*': ['./src/*'] } });
    });

    it('follows a const binding', () => {
      makeDir('lib');
      writeFile(
        'webpack.config.js',
        `const path = require('path');
const libPath = path.join(__dirname, 'lib');

module.exports = { resolve: { modules: [libPath, 'node_modules'] } };
`,
      );

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({ paths: { '*': ['./lib/*'] } });
    });

    it('reads an ESM import of the path module', () => {
      makeDir('src');
      writeFile(
        'webpack.config.mjs',
        "import path from 'node:path';\n\nexport default { resolve: { modules: [path.join(__dirname, 'src')] } };\n",
      );

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({ paths: { '*': ['./src/*'] } });
    });

    it('lists every root in one wildcard pattern, in the order webpack tries them', () => {
      makeDir('src');
      makeDir('vendor');
      writeConfig("{ resolve: { modules: ['src', 'vendor', 'node_modules'] } }");

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        paths: { '*': ['./src/*', './vendor/*'] },
        source: 'webpack.config.js',
        skipped: [],
      });
    });

    it('leaves out a computed entry and names it', () => {
      makeDir('src');
      writeConfig(
        "{ resolve: { modules: [process.env.ROOT || 'nope', path.join(__dirname, 'src')] } }",
      );

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        paths: { '*': ['./src/*'] },
        source: 'webpack.config.js',
        skipped: [
          { name: 'resolve.modules[0]', reason: 'its value is computed when the config runs' },
        ],
      });
    });

    it('leaves out an entry that is not a directory here', () => {
      writeConfig("{ resolve: { modules: ['src', 'node_modules'] } }");

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        source: 'webpack.config.js',
        skipped: [{ name: 'resolve.modules[0]', reason: 'src is not a directory' }],
      });
    });
  });

  describe('resolve.alias', () => {
    it('maps a directory alias and everything under it', () => {
      makeDir('client/app');
      writeConfig("{ resolve: { alias: { '@': path.join(__dirname, 'client', 'app') } } }");

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        paths: { '@': ['./client/app'], '@/*': ['./client/app/*'] },
        source: 'webpack.config.js',
        skipped: [],
      });
    });

    it('maps a trailing $ as an exact match only', () => {
      makeDir('src/shared');
      writeConfig("{ resolve: { alias: { 'shared$': path.join(__dirname, 'src/shared') } } }");

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({
        paths: { shared: ['./src/shared'] },
      });
    });

    it('drops the extension of a file alias so the migrated file resolves', () => {
      writeFile('src/config.js', 'module.exports = {};\n');
      writeConfig("{ resolve: { alias: { config: path.join(__dirname, 'src/config.js') } } }");

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({
        paths: { config: ['./src/config'] },
      });
    });

    it('leaves out an alias whose target is computed, and names it', () => {
      writeConfig('{ resolve: { alias: { extensions: process.env.EXTENSIONS } } }');

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        source: 'webpack.config.js',
        skipped: [
          {
            name: 'resolve.alias "extensions"',
            reason: 'its target is computed when the config runs',
          },
        ],
      });
    });

    it('leaves out an alias whose target does not exist', () => {
      writeConfig("{ resolve: { alias: { '@': path.join(__dirname, 'gone') } } }");

      expect(detectPathAliases(rootDir, webpack)).toEqual({
        source: 'webpack.config.js',
        skipped: [{ name: 'resolve.alias "@"', reason: 'gone does not exist' }],
      });
    });

    it('leaves out an alias pointing outside the migration root', () => {
      writeConfig("{ resolve: { alias: { shared: path.join(__dirname, '..', 'shared') } } }");

      const aliases = detectPathAliases(rootDir, webpack);
      expect(aliases?.paths).toBeUndefined();
      expect(aliases?.skipped[0].name).toBe('resolve.alias "shared"');
      expect(aliases?.skipped[0].reason).toContain('outside the migration root');
    });

    it('does not read a value a let binding could have changed', () => {
      makeDir('src');
      writeFile(
        'webpack.config.js',
        `const path = require('path');
let appPath = path.join(__dirname, 'src');

module.exports = { resolve: { alias: { '@': appPath } } };
`,
      );

      expect(detectPathAliases(rootDir, webpack)?.skipped).toEqual([
        {
          name: 'resolve.alias "@"',
          reason: 'its target is computed when the config runs',
        },
      ]);
    });

    it('leaves out an alias two configs disagree about', () => {
      makeDir('a');
      makeDir('b');
      writeConfig("{ resolve: { alias: { '@': path.join(__dirname, 'a') } } }");
      writeConfig("{ resolve: { alias: { '@': path.join(__dirname, 'b') } } }", 'webpack.config.prod.js');

      const aliases = detectPathAliases(rootDir, webpack);
      expect(aliases?.paths).toEqual({ '@': ['./a'], '@/*': ['./a/*'] });
      expect(aliases?.skipped).toEqual([
        { name: 'resolve.alias "@"', reason: 'the configs disagree about its target' },
      ]);
    });

    it('ignores a rule-level resolve, which configures neither', () => {
      writeConfig(
        '{ module: { rules: [{ test: /\\.js$/, resolve: { fullySpecified: false } }] } }',
      );

      expect(detectPathAliases(rootDir, webpack)).toBeNull();
    });
  });

  describe('jsconfig.json', () => {
    it('takes the paths the project already wrote, and the baseUrl behind them', () => {
      makeDir('src/amo');
      writeFile(
        'jsconfig.json',
        '// for the editor\n{ "compilerOptions": { "baseUrl": ".", "paths": { "amo/*": ["src/amo/*"] } } }\n',
      );

      expect(detectPathAliases(rootDir, null)).toEqual({
        paths: { '*': ['./*'], 'amo/*': ['./src/amo/*'] },
        source: 'jsconfig.json',
        skipped: [],
      });
    });

    it('reads a paths value from the baseUrl it was written against', () => {
      makeDir('src/amo');
      writeFile(
        'jsconfig.json',
        '{ "compilerOptions": { "baseUrl": "src", "paths": { "amo/*": ["amo/*"] } } }',
      );

      expect(detectPathAliases(rootDir, null)).toMatchObject({
        paths: { '*': ['./src/*'], 'amo/*': ['./src/amo/*'] },
      });
    });

    it('is preferred over the webpack config', () => {
      makeDir('src');
      makeDir('app');
      writeFile('jsconfig.json', '{ "compilerOptions": { "baseUrl": "./src" } }');
      writeConfig("{ resolve: { modules: [path.join(__dirname, 'app')] } }");

      expect(detectPathAliases(rootDir, webpack)).toMatchObject({
        paths: { '*': ['./src/*'] },
        source: 'jsconfig.json',
      });
    });

    it('leaves out a paths entry whose target is gone', () => {
      makeDir('src/amo');
      writeFile(
        'jsconfig.json',
        '{ "compilerOptions": { "paths": { "amo/*": ["src/amo/*"], "core/*": ["src/core/*"] } } }',
      );

      expect(detectPathAliases(rootDir, null)).toEqual({
        paths: { 'amo/*': ['./src/amo/*'] },
        source: 'jsconfig.json',
        skipped: [{ name: 'paths "core/*"', reason: 'src/core/* does not exist' }],
      });
    });

    it('leaves out a baseUrl that is not a directory here', () => {
      writeFile('jsconfig.json', '{ "compilerOptions": { "baseUrl": "./src" } }');

      expect(detectPathAliases(rootDir, null)).toEqual({
        source: 'jsconfig.json',
        skipped: [{ name: 'baseUrl', reason: './src is not a directory' }],
      });
    });
  });

  it('reads nothing for a project that configures neither', () => {
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{}');

    expect(detectPathAliases(rootDir, webpack)).toBeNull();
    expect(detectPathAliases(rootDir, null)).toBeNull();
  });

  it('does not read a webpack config on a project the bundler detection calls Vite', () => {
    makeDir('src');
    writeConfig("{ resolve: { modules: [path.join(__dirname, 'src')] } }");

    expect(detectPathAliases(rootDir, vite)).toBeNull();
  });
});

describe('renderPathAliases', () => {
  it('writes nothing when everything was skipped', () => {
    expect(
      renderPathAliases({ source: 'webpack.config.js', skipped: [{ name: 'a', reason: 'b' }] }),
    ).toBe('');
  });

  it('names the file the mapping came from', () => {
    const text = renderPathAliases({
      paths: { '*': ['./src/*'] },
      source: 'webpack.config.js',
      skipped: [],
    });

    expect(text).toContain('webpack.config.js');
    expect(text).toContain('"*": ["./src/*"]');
    expect(text).not.toContain('baseUrl');
  });
});
