import fs from 'fs';
import path from 'path';
import { partitionBootstrapFiles } from '../../utils/bootstrapFiles';
import { createDir, deleteDir } from '../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../test-utils');
  return mockUpdatableLog();
});

function writeFiles(rootDir: string, files: Record<string, string>): void {
  Object.entries(files).forEach(([relPath, text]) => {
    const filePath = path.resolve(rootDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  });
}

const abs = (rootDir: string, ...relPaths: string[]) =>
  relPaths.map((relPath) => path.resolve(rootDir, relPath));

const byFile = (entries: Array<{ file: string; reason: string }>) =>
  new Map(entries.map(({ file, reason }) => [file, reason]));

describe('partitionBootstrapFiles', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('keeps the build chain of an ejected-CRA-shaped project as JavaScript', () => {
    writeFiles(rootDir, {
      'package.json': JSON.stringify({ scripts: { build: 'node scripts/build.js' } }),
      'webpack.config.js': "const paths = require('./config/paths');\nmodule.exports = {};\n",
      'config/paths.js': 'module.exports = {};\n',
      'scripts/build.js': "const config = require('../webpack.config');\n",
      'src/index.js': "import { greet } from './greet';\ngreet();\n",
      'src/greet.js': 'export const greet = () => {};\n',
    });
    const files = abs(
      rootDir,
      'webpack.config.js',
      'config/paths.js',
      'scripts/build.js',
      'src/index.js',
      'src/greet.js',
    );

    const partition = partitionBootstrapFiles(rootDir, files);

    expect(partition.kept.sort()).toEqual(abs(rootDir, 'src/greet.js', 'src/index.js').sort());
    const reasons = byFile(partition.bootstrap);
    expect(reasons.get(path.resolve(rootDir, 'webpack.config.js'))).toBe(
      'config file next to a package.json',
    );
    expect(reasons.get(path.resolve(rootDir, 'scripts/build.js'))).toBe(
      'run with node by the "build" script in package.json',
    );
    expect(reasons.get(path.resolve(rootDir, 'config/paths.js'))).toBe(
      'required by webpack.config.js',
    );
    expect(partition.applicationEntries).toEqual([]);
  });

  it('keeps known config names by name alone, but only next to a package.json', () => {
    writeFiles(rootDir, {
      'package.json': '{}',
      'babel.config.js': 'module.exports = {};\n',
      'jest.config.js': 'module.exports = {};\n',
      'postcss.config.js': 'module.exports = {};\n',
      'karma.conf.js': 'module.exports = () => {};\n',
      'gulpfile.js': '',
      'Gruntfile.js': '',
      '.eslintrc.js': 'module.exports = {};\n',
      'src/app.config.js': 'export default {};\n',
    });
    const configs = [
      'babel.config.js',
      'jest.config.js',
      'postcss.config.js',
      'karma.conf.js',
      'gulpfile.js',
      'Gruntfile.js',
      '.eslintrc.js',
    ];

    const partition = partitionBootstrapFiles(rootDir, abs(rootDir, ...configs, 'src/app.config.js'));

    expect(partition.bootstrap.map(({ file }) => file).sort()).toEqual(
      abs(rootDir, ...configs).sort(),
    );
    expect(partition.kept).toEqual(abs(rootDir, 'src/app.config.js'));
  });

  it('classifies the extension-neutral name table for .cjs and .mjs files too', () => {
    writeFiles(rootDir, {
      'package.json': '{}',
      'webpack.config.cjs': 'module.exports = {};\n',
      'vite.config.mjs': 'export default {};\n',
    });

    const partition = partitionBootstrapFiles(
      rootDir,
      abs(rootDir, 'webpack.config.cjs', 'vite.config.mjs'),
    );

    expect(partition.kept).toEqual([]);
    expect(partition.bootstrap).toHaveLength(2);
  });

  it('reads node script evidence through env prefixes, flags, chains, and nested packages', () => {
    writeFiles(rootDir, {
      'package.json': JSON.stringify({
        scripts: {
          build: 'cross-env NODE_ENV=production node --max-old-space-size=4096 ./tools/build.js && echo done',
          test: 'node -r ./register.js runner.js',
          lint: 'eslint .',
        },
      }),
      'tools/build.js': '',
      'register.js': '',
      'runner.js': '',
      'packages/web/package.json': JSON.stringify({ scripts: { start: 'node serve.js' } }),
      'packages/web/serve.js': '',
      'src/app.js': '',
    });
    const files = abs(
      rootDir,
      'tools/build.js',
      'register.js',
      'runner.js',
      'packages/web/serve.js',
      'src/app.js',
    );

    const partition = partitionBootstrapFiles(rootDir, files);

    const reasons = byFile(partition.bootstrap);
    expect(reasons.get(path.resolve(rootDir, 'tools/build.js'))).toBe(
      'run with node by the "build" script in package.json',
    );
    expect(reasons.get(path.resolve(rootDir, 'register.js'))).toBe(
      'run with node by the "test" script in package.json',
    );
    expect(reasons.get(path.resolve(rootDir, 'runner.js'))).toBe(
      'run with node by the "test" script in package.json',
    );
    expect(reasons.get(path.resolve(rootDir, 'packages/web/serve.js'))).toBe(
      'run with node by the "start" script in packages/web/package.json',
    );
    expect(partition.kept).toEqual(abs(rootDir, 'src/app.js'));
  });

  it('follows the require chain through extensionless and index specifiers', () => {
    writeFiles(rootDir, {
      'package.json': '{}',
      'gulpfile.js': "const tasks = require('./tasks');\n",
      'tasks/index.js': "const helper = require('./helper');\n",
      'tasks/helper.js': '',
      'src/app.js': '',
    });

    const partition = partitionBootstrapFiles(
      rootDir,
      abs(rootDir, 'gulpfile.js', 'tasks/index.js', 'tasks/helper.js', 'src/app.js'),
    );

    const reasons = byFile(partition.bootstrap);
    expect(reasons.get(path.resolve(rootDir, 'tasks/index.js'))).toBe('required by gulpfile.js');
    expect(reasons.get(path.resolve(rootDir, 'tasks/helper.js'))).toBe(
      'required by tasks/index.js',
    );
    expect(partition.kept).toEqual(abs(rootDir, 'src/app.js'));
  });

  it('treats a node script whose require tree spans the project as an application entry', () => {
    const chained: Record<string, string> = {
      'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
      'server.js': "require('./app/mod0');\n",
    };
    for (let i = 0; i < 10; i += 1) {
      chained[`app/mod${i}.js`] = i < 9 ? `require('./mod${i + 1}');\n` : '';
    }
    writeFiles(rootDir, chained);
    const files = abs(
      rootDir,
      'server.js',
      ...Array.from({ length: 10 }, (unused, i) => `app/mod${i}.js`),
      'lib/extra.js',
    );
    writeFiles(rootDir, { 'lib/extra.js': '' });

    const partition = partitionBootstrapFiles(rootDir, files);

    expect(partition.bootstrap.map(({ file }) => file)).toEqual(abs(rootDir, 'server.js'));
    expect(partition.applicationEntries).toEqual([
      {
        file: path.resolve(rootDir, 'server.js'),
        reason: 'run with node by the "start" script in package.json',
        closureSize: 10,
        candidateCount: 12,
      },
    ]);
    expect(partition.kept).toHaveLength(11);
  });

  it('reports bootstrap files the kept side imports when asked', () => {
    writeFiles(rootDir, {
      'package.json': '{}',
      'webpack.config.js': "const shared = require('./src/shared.js');\n",
      'src/shared.js': 'module.exports = {};\n',
      'src/index.js': "import shared from './shared';\n",
    });

    const partition = partitionBootstrapFiles(
      rootDir,
      abs(rootDir, 'webpack.config.js', 'src/shared.js', 'src/index.js'),
      { detectSharedImporters: true },
    );

    expect(partition.kept).toEqual(abs(rootDir, 'src/index.js'));
    expect(partition.shared).toEqual([
      {
        file: path.resolve(rootDir, 'src/shared.js'),
        reason: 'required by webpack.config.js',
        importers: abs(rootDir, 'src/index.js'),
      },
    ]);
  });

  it('ignores node_modules paths in scripts and script-free projects stay untouched', () => {
    writeFiles(rootDir, {
      'package.json': JSON.stringify({
        scripts: { jest: 'node node_modules/jest/bin/jest.js' },
      }),
      'src/app.js': '',
    });

    const partition = partitionBootstrapFiles(rootDir, abs(rootDir, 'src/app.js'));

    expect(partition.bootstrap).toEqual([]);
    expect(partition.kept).toEqual(abs(rootDir, 'src/app.js'));
  });

  it('keeps a known config name without a package.json next to it', () => {
    writeFiles(rootDir, { 'webpack.config.js': 'module.exports = {};\n' });

    const partition = partitionBootstrapFiles(rootDir, abs(rootDir, 'webpack.config.js'));

    expect(partition.bootstrap).toEqual([]);
    expect(partition.kept).toEqual(abs(rootDir, 'webpack.config.js'));
  });

  it('returns empty partitions for an empty file list', () => {
    expect(partitionBootstrapFiles(rootDir, [])).toEqual({
      kept: [],
      bootstrap: [],
      applicationEntries: [],
      shared: [],
    });
  });
});
