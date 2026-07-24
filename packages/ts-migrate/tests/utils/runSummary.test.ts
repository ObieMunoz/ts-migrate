import fs from 'fs';
import path from 'path';
import {
  buildMigrateRunSummary,
  buildRenameRunSummary,
  writeRunSummary,
} from '../../utils/runSummary';
import { createDir, deleteDir } from '../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { noopUpdatableLog } = require('../test-utils');
  return noopUpdatableLog();
});

describe('run summary', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('builds a rename summary with sorted rootDir-relative paths', () => {
    const summary = buildRenameRunSummary({
      rootDir,
      exitCode: 0,
      renamedFiles: [
        { oldFile: path.join(rootDir, 'src', 'z.js'), newFile: path.join(rootDir, 'src', 'z.ts') },
        {
          oldFile: path.join(rootDir, 'src', 'a.jsx'),
          newFile: path.join(rootDir, 'src', 'a.tsx'),
        },
      ],
      skippedBootstrapFiles: [
        { file: path.join(rootDir, 'scripts', 'build.js'), reason: 'run with node' },
        { file: path.join(rootDir, 'config', 'paths.js'), reason: 'required by webpack.config.js' },
      ],
      skippedModuleFiles: [
        { file: path.join(rootDir, 'src', 'Widget.mjs'), reason: 'contains JSX' },
        { file: path.join(rootDir, 'postcss.config.cjs'), reason: 'config file loaded by name' },
      ],
    });

    expect(summary.command).toBe('rename');
    expect(summary.rootDir).toBe(rootDir);
    expect(summary.exitCode).toBe(0);
    expect(summary.dryRun).toBe(false);
    expect(summary.tsMigrateVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(summary.renamedFiles).toEqual([
      { from: 'src/a.jsx', to: 'src/a.tsx' },
      { from: 'src/z.js', to: 'src/z.ts' },
    ]);
    expect(summary.skippedBootstrapFiles).toEqual([
      { file: 'config/paths.js', reason: 'required by webpack.config.js' },
      { file: 'scripts/build.js', reason: 'run with node' },
    ]);
    expect(summary.skippedModuleFiles).toEqual([
      { file: 'postcss.config.cjs', reason: 'config file loaded by name' },
      { file: 'src/Widget.mjs', reason: 'contains JSX' },
    ]);
  });

  it('builds a migrate summary with debt counted only in the changed files', () => {
    fs.mkdirSync(path.join(rootDir, 'src'));
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "compilerOptions": {} }');
    fs.writeFileSync(path.join(rootDir, 'aliases.d.ts'), 'type $TSFixMe = any;\n');
    fs.writeFileSync(
      path.join(rootDir, 'src', 'changed.ts'),
      '// @ts-expect-error TS(2304) FIXME\nfoo();\nconst x: $TSFixMe = 1;\nexport default x;\n',
    );
    fs.writeFileSync(path.join(rootDir, 'src', 'zz.ts'), 'export const z = 1;\n');
    fs.writeFileSync(path.join(rootDir, 'src', 'untouched.ts'), 'export const y: any = 2;\n');

    const summary = buildMigrateRunSummary({
      command: 'migrate',
      rootDir,
      exitCode: 0,
      updatedSourceFiles: new Set([
        path.join(rootDir, 'src', 'zz.ts'),
        path.join(rootDir, 'src', 'changed.ts'),
      ]),
      nonMigratedFilesWithSyntaxErrors: [path.join(rootDir, 'gen', 'broken.d.ts')],
      pluginStats: [
        { pluginName: 'ts-ignore', changedFileCount: 1 },
        { pluginName: 'eslint-fix', changedFileCount: 0 },
      ],
    });

    expect(summary.command).toBe('migrate');
    expect(summary.changedFiles).toEqual(['src/changed.ts', 'src/zz.ts']);
    expect(summary.nonMigratedFilesWithSyntaxErrors).toEqual(['gen/broken.d.ts']);
    expect(summary.plugins).toEqual([
      { name: 'ts-ignore', changedFileCount: 1 },
      { name: 'eslint-fix', changedFileCount: 0 },
    ]);
    // untouched.ts has an explicit any, but the debt is run-scoped.
    expect(summary.changedFilesTypeDebt).toEqual({
      aliasNames: ['$TSFixMe'],
      totals: { tsExpectError: 1, tsIgnore: 0, anyAlias: 1, any: 0, codes: { TS2304: 1 } },
    });
  });

  it('scans the provided contents instead of the disk for a dry run', () => {
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "compilerOptions": {} }');
    // On disk the file is clean; the dry run would have written debt into it.
    fs.writeFileSync(path.join(rootDir, 'changed.ts'), 'export const x = 1;\n');
    const aliasFile = path.join(rootDir, 'ts-migrate-aliases.d.ts');

    const summary = buildMigrateRunSummary({
      command: 'migrate',
      rootDir,
      exitCode: 0,
      dryRun: true,
      updatedSourceFiles: new Set([path.join(rootDir, 'changed.ts')]),
      fileContents: new Map([
        [
          path.join(rootDir, 'changed.ts'),
          '// @ts-expect-error TS(2304) FIXME\nfoo();\nexport const x: $TSFixMe = 1;\n',
        ],
        // Would be created by the run; exists only in memory.
        [aliasFile, 'type $TSFixMe = any;\n'],
      ]),
      nonMigratedFilesWithSyntaxErrors: [],
      pluginStats: [],
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.changedFilesTypeDebt).toEqual({
      aliasNames: ['$TSFixMe'],
      totals: { tsExpectError: 1, tsIgnore: 0, anyAlias: 1, any: 0, codes: { TS2304: 1 } },
    });
  });

  it('reports null debt when the post-run scan fails', () => {
    // No tsconfig.json in rootDir, so the scan throws.
    const summary = buildMigrateRunSummary({
      command: 'reignore',
      rootDir,
      exitCode: 0,
      updatedSourceFiles: new Set(),
      nonMigratedFilesWithSyntaxErrors: [],
      pluginStats: [],
    });

    expect(summary.command).toBe('reignore');
    expect(summary.changedFilesTypeDebt).toBeNull();
  });

  it('writes the file and returns the run exit code', () => {
    const file = path.join(rootDir, 'summary.json');
    const summary = buildRenameRunSummary({ rootDir, exitCode: 0, renamedFiles: [] });

    expect(writeRunSummary(file, summary)).toBe(0);
    const written = fs.readFileSync(file, 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written)).toEqual(summary);
  });

  it('forces a nonzero exit code when the file cannot be written', () => {
    const file = path.join(rootDir, 'missing-dir', 'summary.json');

    const succeeded = buildRenameRunSummary({ rootDir, exitCode: 0, renamedFiles: [] });
    expect(writeRunSummary(file, succeeded)).toBe(1);

    // A run that already failed keeps its own exit code.
    const failed = buildRenameRunSummary({ rootDir, exitCode: -1, renamedFiles: [] });
    expect(writeRunSummary(file, failed)).toBe(-1);
  });
});
