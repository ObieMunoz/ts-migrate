import path from 'path';
import fs from 'fs';
import reignore from '../../../commands/reignore';
import { createDir, deleteDir, hashDir } from '../../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../../test-utils');
  return mockUpdatableLog();
});

describe('reignore command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('only touches files matching sources', async () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['.'] }),
    );
    fs.mkdirSync(path.resolve(rootDir, 'migrated'));
    fs.mkdirSync(path.resolve(rootDir, 'untouched'));
    fs.writeFileSync(
      path.resolve(rootDir, 'migrated/file.ts'),
      `// @ts-expect-error FIXME: no longer needed
const fine: number = 1;
const broken: number = 'oops';
`,
    );
    // Out of scope, so its unneeded suppression must survive byte for byte.
    const untouchedText = `// @ts-expect-error FIXME: no longer needed
const alsoFine: number = 2;
`;
    fs.writeFileSync(path.resolve(rootDir, 'untouched/file.ts'), untouchedText);

    const { exitCode, updatedSourceFiles, nonMigratedFilesWithSyntaxErrors, pluginStats } =
      await reignore({
        rootDir,
        sources: 'migrated/**/*',
        messagePrefix: 'FIXME',
      });

    expect(exitCode).toBe(0);
    const migratedText = fs.readFileSync(path.resolve(rootDir, 'migrated/file.ts'), 'utf8');
    expect(migratedText).not.toContain('no longer needed');
    expect(migratedText).toMatch(/@ts-expect-error TS\(2322\) FIXME/);
    expect(fs.readFileSync(path.resolve(rootDir, 'untouched/file.ts'), 'utf8')).toBe(untouchedText);

    // The migrate result fields pass through for the --jsonSummary flag.
    expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'migrated/file.ts')]);
    expect(nonMigratedFilesWithSyntaxErrors).toEqual([]);
    expect(pluginStats.map(({ pluginName }) => pluginName)).toEqual([
      'strip-ts-ignore',
      'detect-types-packages',
      'ts-ignore',
      'eslint-fix-changed',
    ]);
    expect(pluginStats[0].changedFileCount).toBe(1);
    expect(pluginStats[2].changedFileCount).toBe(1);
  }, 10000);

  it('dry run leaves the tree byte-identical and returns the would-be text', async () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['.'] }),
    );
    const file = path.resolve(rootDir, 'file.ts');
    fs.writeFileSync(
      file,
      `// @ts-expect-error FIXME: no longer needed
const fine: number = 1;
const broken: number = 'oops';
`,
    );
    const hashBefore = hashDir(rootDir);

    const { exitCode, updatedSourceFiles, updatedFileTexts } = await reignore({
      rootDir,
      messagePrefix: 'FIXME',
      dryRun: true,
    });

    expect(exitCode).toBe(0);
    expect(hashDir(rootDir)).toBe(hashBefore);
    expect([...updatedSourceFiles]).toEqual([file]);
    const wouldBeText = updatedFileTexts.get(file);
    expect(wouldBeText).not.toContain('no longer needed');
    expect(wouldBeText).toMatch(/@ts-expect-error TS\(2322\) FIXME/);
  }, 10000);
});
