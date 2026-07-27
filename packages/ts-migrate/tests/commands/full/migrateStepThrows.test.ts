import fs from 'fs';
import os from 'os';
import path from 'path';
import full from '../../../commands/full';
import { deleteDir, transcriptLines } from '@obiemunoz/ts-migrate-test-utils';

/**
 * A plugin that throws is the one failure the migrate step cannot report on its
 * own, and it is the one where the run's own report matters most: which step
 * stopped it, what the working tree now holds, and the recommendations gathered
 * so far. Left unhandled it would surface as a ts-migrate crash instead.
 *
 * Its own suite because the throw has to come from the migrate module, which
 * every other case in this directory needs to run for real.
 */
jest.mock('updatable-log', () => {
  const { collectingUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return collectingUpdatableLog();
});

jest.mock('../../../commands/runMigrate', () => ({
  __esModule: true,
  default: jest.fn(async () => {
    throw new Error('a plugin exploded');
  }),
}));

let rootDir: string;

beforeEach(() => {
  transcriptLines.length = 0;
  rootDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-full-throw-'));
  fs.mkdirSync(path.join(rootDir, 'src'));
  fs.writeFileSync(path.join(rootDir, 'package.json'), '{ "name": "demo" }\n');
  fs.writeFileSync(path.join(rootDir, 'src', 'index.js'), 'module.exports = 1;\n');
});

afterEach(() => {
  deleteDir(rootDir);
});

it('reports the failing step when the migrate step throws', async () => {
  const { exitCode, summary } = await full({
    rootDir,
    folder: rootDir,
    typeScript: { packageDir: rootDir, version: '5.7.3', source: 'project' },
    yes: true,
    commit: false,
    blameIgnoreRevs: false,
    dryRun: false,
    renameOptions: {},
    migrateOptions: { plugins: {} },
  });

  const output = transcriptLines.join('\n');
  expect(exitCode).toBe(255);
  expect(output).toContain('a plugin exploded');
  expect(output).toContain('Step 3 of 4 (migrate) failed (exit 255)');
  expect(output).toContain("This run's partial result is in the working tree");
  expect(output).not.toContain('All done!');
  expect(summary.steps.map((step) => step.status)).toEqual([
    'ok',
    'ok',
    'failed',
    'not-reached',
  ]);
  // A failed step leaves the project's own files behind, and nothing else.
  expect(fs.existsSync(path.join(rootDir, '.eslintrc'))).toBe(false);
}, 120000);
