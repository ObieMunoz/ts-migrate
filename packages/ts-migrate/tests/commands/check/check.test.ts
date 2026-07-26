import fs from 'fs';
import path from 'path';
import check, { DEFAULT_BASELINE_FILE } from '../../../commands/check';
import { createDir, deleteDir } from '@obiemunoz/ts-migrate-test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { noopUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return noopUpdatableLog();
});

const fileWithDebt = `// @ts-expect-error TS(2304) FIXME: Cannot find name 'foo'.
foo();
const x: any = 1;
export default x;
`;

function writeProject(rootDir: string) {
  fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "compilerOptions": {} }');
  fs.writeFileSync(path.join(rootDir, 'a.ts'), fileWithDebt);
}

function readBaseline(rootDir: string) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'utf-8'));
}

describe('check command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
    writeProject(rootDir);
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('writes a baseline on the first run and passes while counts are stable', () => {
    expect(check({ rootDir, folder: 'foo' })).toBe(0);

    const baseline = readBaseline(rootDir);
    expect(baseline.version).toBe(1);
    expect(baseline.files['a.ts']).toEqual({
      tsExpectError: 1,
      tsIgnore: 0,
      anyAlias: 0,
      any: 1,
    });

    const baselineText = fs.readFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'utf-8');
    expect(check({ rootDir, folder: 'foo' })).toBe(0);
    expect(fs.readFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'utf-8')).toBe(baselineText);
  });

  it('exits nonzero when a per-file count grows and keeps the baseline', () => {
    expect(check({ rootDir, folder: 'foo' })).toBe(0);
    const baselineText = fs.readFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'utf-8');

    fs.appendFileSync(path.join(rootDir, 'a.ts'), 'export const y: any = 2;\n');

    expect(check({ rootDir, folder: 'foo' })).toBe(1);
    expect(fs.readFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'utf-8')).toBe(baselineText);
  });

  it('fails on debt in a file that is not in the baseline', () => {
    expect(check({ rootDir, folder: 'foo' })).toBe(0);

    fs.writeFileSync(path.join(rootDir, 'b.ts'), 'export const z: any = 3;\n');

    expect(check({ rootDir, folder: 'foo' })).toBe(1);
  });

  it('lowers the baseline automatically on improvement', () => {
    expect(check({ rootDir, folder: 'foo' })).toBe(0);

    fs.writeFileSync(
      path.join(rootDir, 'a.ts'),
      '// @ts-expect-error TS(2304) FIXME: Cannot find name \'foo\'.\nfoo();\nexport default 1;\n',
    );

    expect(check({ rootDir, folder: 'foo' })).toBe(0);
    expect(readBaseline(rootDir).files['a.ts']).toEqual({
      tsExpectError: 1,
      tsIgnore: 0,
      anyAlias: 0,
      any: 0,
    });
  });

  it('accepts grown counts with --updateBaseline', () => {
    expect(check({ rootDir, folder: 'foo' })).toBe(0);
    fs.appendFileSync(path.join(rootDir, 'a.ts'), 'export const y: any = 2;\n');

    expect(check({ rootDir, folder: 'foo', updateBaseline: true })).toBe(0);
    expect(readBaseline(rootDir).files['a.ts'].any).toBe(2);
    expect(check({ rootDir, folder: 'foo' })).toBe(0);
  });

  it('errors on an unreadable baseline', () => {
    fs.writeFileSync(path.join(rootDir, DEFAULT_BASELINE_FILE), 'not json');
    expect(check({ rootDir, folder: 'foo' })).toBe(-1);
  });

  it('honors --baselineFile', () => {
    const baselineFile = path.join(rootDir, 'debt', 'custom-baseline.json');
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });

    expect(check({ rootDir, folder: 'foo', baselineFile })).toBe(0);
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(fs.existsSync(path.join(rootDir, DEFAULT_BASELINE_FILE))).toBe(false);
  });

  describe('a baseline that cannot be written', () => {
    // A --baselineFile under a directory that does not exist. Every other
    // output path the CLI takes reports this; this one used to reach the
    // process, where the crash handler names a mistyped path a ts-migrate bug.
    const unwritable = (dir: string) => path.join(dir, 'missing', 'baseline.json');

    it('errors instead of throwing when there is no baseline yet', () => {
      const baselineFile = unwritable(rootDir);

      expect(check({ rootDir, folder: 'foo', baselineFile })).toBe(-1);
      expect(fs.existsSync(baselineFile)).toBe(false);
    });

    it('errors instead of throwing with --updateBaseline', () => {
      const baselineFile = unwritable(rootDir);

      expect(check({ rootDir, folder: 'foo', baselineFile, updateBaseline: true })).toBe(-1);
      expect(fs.existsSync(baselineFile)).toBe(false);
    });

    it('still passes when the ratchet held and only lowering the baseline failed', () => {
      expect(check({ rootDir, folder: 'foo' })).toBe(0);
      const baselinePath = path.join(rootDir, DEFAULT_BASELINE_FILE);
      const baselineText = fs.readFileSync(baselinePath, 'utf-8');

      // Debt drops, so the run wants to lower the baseline. The baseline still
      // has to read back for the comparison to get that far, so the write is
      // what fails here and not the file: a read-only checkout is the case,
      // and mocking it keeps that off the test's own permissions.
      fs.writeFileSync(
        path.join(rootDir, 'a.ts'),
        "// @ts-expect-error TS(2304) FIXME: Cannot find name 'foo'.\nfoo();\nexport default 1;\n",
      );
      const writeFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      });

      try {
        expect(check({ rootDir, folder: 'foo' })).toBe(0);
      } finally {
        writeFileSync.mockRestore();
      }
      expect(fs.readFileSync(baselinePath, 'utf-8')).toBe(baselineText);
    });
  });
});
