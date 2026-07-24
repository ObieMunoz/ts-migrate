import path from 'path';
import log from 'updatable-log';
import rename from '../../../commands/rename';
import { createDir, copyDir, deleteDir, getDirData, hashDir } from '../../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../../test-utils');
  return mockUpdatableLog();
});

const expectedRenames = [
  { oldFile: 'dir-a/file-2.js', newFile: 'dir-a/file-2.ts' },
  { oldFile: 'dir-a/file-3.jsx', newFile: 'dir-a/file-3.tsx' },
  { oldFile: 'dir-a/file-4.js', newFile: 'dir-a/file-4.tsx' },
  { oldFile: 'dir-a/file-5.js', newFile: 'dir-a/file-5.tsx' },
  { oldFile: 'dir-a/file-6.js', newFile: 'dir-a/file-6.tsx' },
  { oldFile: 'dir-a/file-7.js', newFile: 'dir-a/file-7.tsx' },
  { oldFile: 'file-1.js', newFile: 'file-1.ts' },
];

const sortedRelativeTo = (
  rootDir: string,
  renamedFiles: Array<{ oldFile: string; newFile: string }> | null,
) =>
  renamedFiles
    ?.map(({ oldFile, newFile }) => ({
      oldFile: path.relative(rootDir, oldFile),
      newFile: path.relative(rootDir, newFile),
    }))
    .sort((a, b) => (a.oldFile + a.newFile < b.oldFile + b.newFile ? -1 : 1));

describe('rename command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('Renames JS/JSX files to TS/TSX', () => {
    const inputDir = path.resolve(__dirname, 'input');
    const outputDir = path.resolve(__dirname, 'output');
    copyDir(inputDir, rootDir);

    const renamedFiles = rename({ rootDir });

    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(sortedRelativeTo(rootDir, renamedFiles)).toEqual(expectedRenames);
  });

  it('Dry run prints the mapping and leaves the tree byte-identical', () => {
    const inputDir = path.resolve(__dirname, 'input');
    copyDir(inputDir, rootDir);
    const hashBefore = hashDir(rootDir);
    const infoSpy = jest.spyOn(log, 'info');

    const renamedFiles = rename({ rootDir, dryRun: true });

    expect(hashDir(rootDir)).toBe(hashBefore);
    expect(sortedRelativeTo(rootDir, renamedFiles)).toEqual(expectedRenames);

    const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
    expect(infoMessages).toContainEqual(
      expect.stringContaining('7 JS/JSX file(s) would be renamed'),
    );
    // The mapping surfaces each .ts vs .tsx decision.
    expect(infoMessages).toContainEqual(expect.stringContaining('file-1.js -> file-1.ts'));
    expect(infoMessages).toContainEqual(
      expect.stringContaining(`dir-a${path.sep}file-4.js -> dir-a${path.sep}file-4.tsx`),
    );
    expect(infoMessages).toContainEqual(
      expect.stringContaining('would update allowedImports in'),
    );
    infoSpy.mockRestore();
  });
});
