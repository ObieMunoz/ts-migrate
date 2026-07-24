import { execFileSync } from 'child_process';
import fs from 'fs';
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

    const result = rename({ rootDir });

    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual(expectedRenames);
    expect(result?.skippedGitignoredFiles).toBe(0);
  });

  it('Dry run prints the mapping and leaves the tree byte-identical', () => {
    const inputDir = path.resolve(__dirname, 'input');
    copyDir(inputDir, rootDir);
    const hashBefore = hashDir(rootDir);
    const infoSpy = jest.spyOn(log, 'info');

    const result = rename({ rootDir, dryRun: true });

    expect(hashDir(rootDir)).toBe(hashBefore);
    expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual(expectedRenames);

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

  describe('gitignored files', () => {
    const setUpGitignoredProject = () => {
      execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
      const writeFile = (relPath: string, text: string) => {
        const filePath = path.resolve(rootDir, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text);
      };
      writeFile('tsconfig.json', JSON.stringify({ include: ['./**/*'] }));
      writeFile('.gitignore', 'dist/\n');
      writeFile('src/app.js', 'const a = 1;\n');
      writeFile('dist/bundle.js', 'const b = 2;\n');
    };

    it('skips them by default', () => {
      setUpGitignoredProject();
      const infoSpy = jest.spyOn(log, 'info');

      const result = rename({ rootDir });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(result?.skippedGitignoredFiles).toBe(1);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.js'))).toBe(true);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.ts'))).toBe(false);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Skipping 1 gitignored JS/JSX file(s) (dist/bundle.js)'),
      );
      infoSpy.mockRestore();
    });

    it('renames them with gitignore disabled', () => {
      setUpGitignoredProject();

      const result = rename({ rootDir, gitignore: false });

      expect(sortedRelativeTo(rootDir, result?.renamedFiles ?? null)).toEqual([
        { oldFile: `dist${path.sep}bundle.js`, newFile: `dist${path.sep}bundle.ts` },
        { oldFile: `src${path.sep}app.js`, newFile: `src${path.sep}app.ts` },
      ]);
      expect(result?.skippedGitignoredFiles).toBe(0);
      expect(fs.existsSync(path.resolve(rootDir, 'dist/bundle.ts'))).toBe(true);
    });
  });
});
