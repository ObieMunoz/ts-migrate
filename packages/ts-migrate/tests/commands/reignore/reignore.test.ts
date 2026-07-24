import path from 'path';
import fs from 'fs';
import reignore from '../../../commands/reignore';
import { createDir, deleteDir } from '../../test-utils';

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

    const { exitCode } = await reignore({
      rootDir,
      sources: 'migrated/**/*',
      messagePrefix: 'FIXME',
    });

    expect(exitCode).toBe(0);
    const migratedText = fs.readFileSync(path.resolve(rootDir, 'migrated/file.ts'), 'utf8');
    expect(migratedText).not.toContain('no longer needed');
    expect(migratedText).toMatch(/@ts-expect-error TS\(2322\) FIXME/);
    expect(fs.readFileSync(path.resolve(rootDir, 'untouched/file.ts'), 'utf8')).toBe(untouchedText);
  }, 10000);
});
