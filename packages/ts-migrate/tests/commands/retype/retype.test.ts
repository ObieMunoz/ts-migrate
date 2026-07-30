import path from 'path';
import fs from 'fs';
import { createDir, deleteDir, hashDir } from '@obiemunoz/ts-migrate-test-utils';
import reignore from '../../../commands/reignore';

jest.mock('updatable-log', () => {
  const { mockUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return mockUpdatableLog();
});

/** What `ts-migrate retype` passes reignore, minus the folder under test. */
const retypeOptions = { gitignore: false, annotations: true, casts: true };

describe('retype command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  /**
   * A migrated project holding one annotation the installed @types package now
   * makes inferable and one nothing can infer, plus the alias declarations a
   * migration writes.
   */
  function writeMigratedProject(): string {
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
  export function store(widget: { id: number }): number;
}
`,
    );
    fs.writeFileSync(
      path.resolve(rootDir, 'ts-migrate-aliases.d.ts'),
      `type $TSFixMe = any;
`,
    );
    const file = path.resolve(rootDir, 'src.ts');
    fs.writeFileSync(
      file,
      `import { store } from 'legacy-widget';

export function save(widget: $TSFixMe) {
  return store(widget);
}

export function untouched(value: $TSFixMe) {
  switch   (1) {
    default:
      return value;
  }
}
`,
    );
    return file;
  }

  it('replaces the annotation the installed types resolve and restores the other', async () => {
    const file = writeMigratedProject();

    const { exitCode, updatedSourceFiles, pluginStats } = await reignore({
      rootDir,
      ...retypeOptions,
    });

    expect(exitCode).toBe(0);
    expect(pluginStats.map(({ pluginName }) => pluginName)).toContain('retry-annotations');
    expect([...updatedSourceFiles]).toEqual([file]);
    // The annotation nothing can infer is restored from the original bytes, so
    // the odd spacing in the untouched function stays.
    expect(fs.readFileSync(file, 'utf8')).toBe(`import { store } from 'legacy-widget';

export function save(widget: { id: number; }) {
  return store(widget);
}

export function untouched(value: $TSFixMe) {
  switch   (1) {
    default:
      return value;
  }
}
`);
  }, 30000);

  it('changes nothing on a second run', async () => {
    const file = writeMigratedProject();
    await reignore({ rootDir, ...retypeOptions });
    const afterFirst = fs.readFileSync(file, 'utf8');

    const { exitCode, updatedSourceFiles } = await reignore({ rootDir, ...retypeOptions });

    expect(exitCode).toBe(0);
    expect([...updatedSourceFiles]).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(afterFirst);
  }, 60000);

  it('leaves every annotation alone without the annotation retry', async () => {
    const file = writeMigratedProject();
    const before = fs.readFileSync(file, 'utf8');

    const { exitCode, pluginStats } = await reignore({ rootDir, gitignore: false });

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(pluginStats.map(({ pluginName }) => pluginName)).not.toContain('retry-annotations');
  }, 30000);

  it('dry run leaves the tree byte-identical and returns the would-be text', async () => {
    writeMigratedProject();
    const hashBefore = hashDir(rootDir);

    const { exitCode, updatedFileTexts } = await reignore({
      rootDir,
      ...retypeOptions,
      dryRun: true,
    });

    expect(exitCode).toBe(0);
    expect(hashDir(rootDir)).toBe(hashBefore);
    expect(updatedFileTexts.get(path.resolve(rootDir, 'src.ts'))).toContain(
      'export function save(widget: { id: number; })',
    );
  }, 30000);

  it('suppresses the error a replaced annotation reveals in another file', async () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['.'] }),
    );
    // `save` narrows to what its body needs, which the caller next door
    // violates. The suppression pass runs after the retry for that reason.
    fs.writeFileSync(
      path.resolve(rootDir, 'save.ts'),
      `export function save(widget: any) {
  return widget.id.toFixed(2);
}
`,
    );
    const caller = path.resolve(rootDir, 'caller.ts');
    fs.writeFileSync(
      caller,
      `import { save } from './save';

export const saved = save({ id: 'not a number' });
`,
    );

    const { exitCode } = await reignore({ rootDir, ...retypeOptions });

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(path.resolve(rootDir, 'save.ts'), 'utf8')).toContain(
      'export function save(widget: { id: number; }) {',
    );
    expect(fs.readFileSync(caller, 'utf8')).toMatch(/@ts-expect-error TS\(2322\)/);
  }, 30000);
});
