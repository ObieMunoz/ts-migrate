import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import reignore from '../../../commands/reignore';
import { createDir, deleteDir, hashDir } from '@obiemunoz/ts-migrate-test-utils';

jest.mock('updatable-log', () => {
  const { mockUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
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

  /**
   * A project whose one migrated file holds two conversions: one over a
   * property the installed @types package now declares, one over a property
   * nothing declares.
   */
  function writeConvertedProject(): string {
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { noEmit: true, strict: true, types: ['legacy-widget'] },
        include: ['.'],
      }),
    );
    const typesDir = path.resolve(rootDir, 'node_modules/@types/legacy-widget');
    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(
      path.resolve(typesDir, 'package.json'),
      JSON.stringify({ name: '@types/legacy-widget', version: '1.0.0', types: 'index.d.ts' }),
    );
    fs.writeFileSync(
      path.resolve(typesDir, 'index.d.ts'),
      `declare module 'legacy-widget' {
  export const widget: { name: string };
}
`,
    );
    const file = path.resolve(rootDir, 'src.ts');
    fs.writeFileSync(
      file,
      `import { widget } from 'legacy-widget';

export const name = (widget as any).name;

export function missing(  ) {
  return (widget as any).notDeclared;
}
`,
    );
    return file;
  }

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

    const {
      exitCode,
      updatedSourceFiles,
      nonMigratedFilesWithSyntaxErrors,
      pluginStats,
      suppressionExplainer,
    } = await reignore({
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
      'declare-untyped-modules',
      'explain-suppressions',
      'ts-ignore',
      'eslint-fix-changed',
    ]);
    expect(pluginStats[0].changedFileCount).toBe(1);
    expect(pluginStats[4].changedFileCount).toBe(1);

    // The evidence behind the suppression the run just wrote. Line 2 because
    // strip-ts-ignore removed the stale comment before the explainer ran.
    const report = suppressionExplainer.summarize(rootDir);
    expect(report.sites).toEqual([
      expect.objectContaining({
        code: 2322,
        location: { file: 'migrated/file.ts', line: 2, column: 7 },
        commented: true,
        evidence: expect.objectContaining({ expectedType: 'number', actualType: '"oops"' }),
      }),
    ]);
  });

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
  });

  it('leaves gitignored files unsuppressed and counts them', async () => {
    execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['.'] }),
    );
    fs.writeFileSync(path.resolve(rootDir, '.gitignore'), 'generated/\n');
    fs.mkdirSync(path.resolve(rootDir, 'generated'));
    fs.writeFileSync(path.resolve(rootDir, 'src.ts'), "const broken: number = 'oops';\n");
    const generatedText = "const alsoBroken: number = 'oops';\n";
    fs.writeFileSync(path.resolve(rootDir, 'generated/file.ts'), generatedText);

    const { exitCode, updatedSourceFiles, skippedGitignoredFiles } = await reignore({
      rootDir,
      messagePrefix: 'FIXME',
    });

    expect(exitCode).toBe(0);
    expect(skippedGitignoredFiles).toBe(1);
    expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'src.ts')]);
    expect(fs.readFileSync(path.resolve(rootDir, 'src.ts'), 'utf8')).toMatch(
      /@ts-expect-error TS\(2322\) FIXME/,
    );
    expect(fs.readFileSync(path.resolve(rootDir, 'generated/file.ts'), 'utf8')).toBe(generatedText);
  });

  it('leaves every conversion alone without --casts', async () => {
    const file = writeConvertedProject();
    const before = fs.readFileSync(file, 'utf8');

    const { exitCode, pluginStats } = await reignore({ rootDir, gitignore: false });

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(pluginStats.map(({ pluginName }) => pluginName)).not.toContain('retry-conversions');
  }, 30000);

  it('drops the conversion the installed types resolve and keeps the other', async () => {
    const file = writeConvertedProject();

    const { exitCode, updatedSourceFiles, pluginStats } = await reignore({
      rootDir,
      gitignore: false,
      casts: true,
    });

    expect(exitCode).toBe(0);
    expect(pluginStats.map(({ pluginName }) => pluginName)).toContain('retry-conversions');
    expect([...updatedSourceFiles]).toEqual([file]);
    // The surviving assertion and the formatting around it are restored from
    // the original bytes, so the odd spacing in the untouched statement stays.
    expect(fs.readFileSync(file, 'utf8')).toBe(`import { widget } from 'legacy-widget';

export const name = widget.name;

export function missing(  ) {
  return (widget as any).notDeclared;
}
`);
  }, 30000);

  it('changes nothing on a second --casts run', async () => {
    const file = writeConvertedProject();
    await reignore({ rootDir, gitignore: false, casts: true });
    const afterFirst = fs.readFileSync(file, 'utf8');

    const { exitCode, updatedSourceFiles } = await reignore({
      rootDir,
      gitignore: false,
      casts: true,
    });

    expect(exitCode).toBe(0);
    expect([...updatedSourceFiles]).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(afterFirst);
  }, 60000);
});
