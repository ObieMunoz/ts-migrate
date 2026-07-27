import fs from 'fs';
import os from 'os';
import path from 'path';
import full from '../../../commands/full';
import { deleteDir, transcriptLines } from '@obiemunoz/ts-migrate-test-utils';

/**
 * What the migrate step finds on disk where an ESLint config would be. The run
 * used to write an empty `.eslintrc` there for eslint-fix to find, which no
 * ESLint can lint a migrated file with: it enables no rules, and its parser
 * defaults reject every `import`, `export` and type annotation the migration
 * produces. All it changed was the report, from "no ESLint configuration
 * found" into a parse failure blamed on a config the project never had and
 * this run deleted before it ended.
 *
 * Its own suite because it has to watch the project mid-run, which means
 * standing in for the migrate step rather than running it.
 */
jest.mock('updatable-log', () => {
  const { collectingUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return collectingUpdatableLog();
});

/** What the project looked like where an ESLint config would be, mid-migrate. */
const seenDuringMigrate: Array<{ entries: string[]; eslintrc: string | null }> = [];

jest.mock('../../../commands/runMigrate', () => ({
  __esModule: true,
  default: jest.fn(async ({ rootDir }: { rootDir: string }) => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const eslintrcPath = realPath.join(rootDir, '.eslintrc');
    seenDuringMigrate.push({
      entries: realFs.readdirSync(rootDir).filter((e: string) => e.includes('eslint')),
      eslintrc: realFs.existsSync(eslintrcPath)
        ? realFs.readFileSync(eslintrcPath, 'utf-8')
        : null,
    });
    return { exitCode: 0 };
  }),
}));

let rootDir: string;
let compilerDir: string;

const createDir = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-full-'));

beforeEach(() => {
  transcriptLines.length = 0;
  seenDuringMigrate.length = 0;
  rootDir = createDir();
  compilerDir = createDir();
  fs.mkdirSync(path.join(compilerDir, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(compilerDir, 'package.json'),
    '{"name":"typescript","version":"5.7.3"}',
  );
  fs.writeFileSync(path.join(compilerDir, 'bin', 'tsc'), 'process.exit(0);\n');
  fs.mkdirSync(path.join(rootDir, 'src'));
  fs.writeFileSync(path.join(rootDir, 'package.json'), '{ "name": "demo" }\n');
  fs.writeFileSync(path.join(rootDir, 'src', 'index.js'), 'module.exports = 1;\n');
});

afterEach(() => {
  deleteDir(rootDir);
  deleteDir(compilerDir);
});

const run = () =>
  full({
    rootDir,
    folder: rootDir,
    typeScript: { packageDir: compilerDir, version: '5.7.3', source: 'project' },
    yes: true,
    commit: false,
    blameIgnoreRevs: false,
    dryRun: false,
    renameOptions: {},
    migrateOptions: { plugins: {} },
  });

it('leaves a project that has no ESLint config without one', async () => {
  const { exitCode } = await run();

  expect(exitCode).toBe(0);
  expect(seenDuringMigrate).toEqual([{ entries: [], eslintrc: null }]);
  expect(fs.existsSync(path.join(rootDir, '.eslintrc'))).toBe(false);
}, 120000);

it("leaves the project's own ESLint config alone", async () => {
  const contents = '{ "rules": { "semi": "error" } }\n';
  fs.writeFileSync(path.join(rootDir, '.eslintrc.json'), contents);

  await run();

  expect(seenDuringMigrate).toEqual([{ entries: ['.eslintrc.json'], eslintrc: null }]);
  expect(fs.readFileSync(path.join(rootDir, '.eslintrc.json'), 'utf-8')).toBe(contents);
}, 120000);

it("leaves the project's own extensionless .eslintrc alone", async () => {
  const contents = '{ "rules": { "semi": "error" } }\n';
  fs.writeFileSync(path.join(rootDir, '.eslintrc'), contents);

  await run();

  expect(seenDuringMigrate).toEqual([{ entries: ['.eslintrc'], eslintrc: contents }]);
  expect(fs.readFileSync(path.join(rootDir, '.eslintrc'), 'utf-8')).toBe(contents);
}, 120000);
