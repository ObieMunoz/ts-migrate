import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { partitionGitignored, sampleIgnoredPaths } from '../../utils/gitignore';
import { createDir, deleteDir } from '../test-utils';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../test-utils');
  return mockUpdatableLog();
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function writeFiles(rootDir: string, files: Record<string, string>): void {
  Object.entries(files).forEach(([relPath, text]) => {
    const filePath = path.resolve(rootDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  });
}

const abs = (rootDir: string, ...relPaths: string[]) =>
  relPaths.map((relPath) => path.resolve(rootDir, relPath));

describe('partitionGitignored', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('partitions by the repository rules, including negations and nested .gitignore files', () => {
    git(rootDir, 'init');
    writeFiles(rootDir, {
      '.gitignore': 'dist/\n*.gen.ts\n!keep.gen.ts\n',
      'src/.gitignore': 'local-only.ts\n',
      'src/app.ts': '',
      'src/local-only.ts': '',
      'src/types.gen.ts': '',
      'keep.gen.ts': '',
      'dist/bundle.ts': '',
      'dist/sub/x.ts': '',
    });

    const files = abs(
      rootDir,
      'src/app.ts',
      'src/local-only.ts',
      'src/types.gen.ts',
      'keep.gen.ts',
      'dist/bundle.ts',
      'dist/sub/x.ts',
    );
    const partition = partitionGitignored(rootDir, files);

    expect(partition.unfiltered).toBeUndefined();
    expect(partition.kept.sort()).toEqual(abs(rootDir, 'keep.gen.ts', 'src/app.ts').sort());
    expect(partition.ignored.sort()).toEqual(
      abs(rootDir, 'dist/bundle.ts', 'dist/sub/x.ts', 'src/local-only.ts', 'src/types.gen.ts').sort(),
    );
  });

  it('never ignores a tracked file, even when it matches a pattern', () => {
    git(rootDir, 'init');
    writeFiles(rootDir, {
      '.gitignore': '*.gen.ts\n',
      'tracked.gen.ts': '',
      'untracked.gen.ts': '',
    });
    git(rootDir, 'add', '-f', 'tracked.gen.ts');

    const partition = partitionGitignored(
      rootDir,
      abs(rootDir, 'tracked.gen.ts', 'untracked.gen.ts'),
    );

    expect(partition.kept).toEqual(abs(rootDir, 'tracked.gen.ts'));
    expect(partition.ignored).toEqual(abs(rootDir, 'untracked.gen.ts'));
  });

  it('applies the rules of an enclosing repository when rootDir is a subdirectory', () => {
    git(rootDir, 'init');
    writeFiles(rootDir, {
      '.gitignore': 'dist/\n',
      'frontend/src/app.ts': '',
      'frontend/dist/bundle.ts': '',
    });

    const projectDir = path.resolve(rootDir, 'frontend');
    const partition = partitionGitignored(
      projectDir,
      abs(projectDir, 'src/app.ts', 'dist/bundle.ts'),
    );

    expect(partition.unfiltered).toBeUndefined();
    expect(partition.kept).toEqual(abs(projectDir, 'src/app.ts'));
    expect(partition.ignored).toEqual(abs(projectDir, 'dist/bundle.ts'));
  });

  it('disables filtering when rootDir is itself gitignored', () => {
    git(rootDir, 'init');
    writeFiles(rootDir, {
      '.gitignore': 'sandbox/\n',
      'sandbox/src/app.ts': '',
      'sandbox/dist/bundle.ts': '',
    });

    const projectDir = path.resolve(rootDir, 'sandbox');
    const files = abs(projectDir, 'src/app.ts', 'dist/bundle.ts');
    const partition = partitionGitignored(projectDir, files);

    expect(partition.unfiltered).toBe('root-dir-ignored');
    expect(partition.kept).toEqual(files);
    expect(partition.ignored).toEqual([]);
  });

  it('keeps files outside the repository toplevel without consulting git about them', () => {
    const repoDir = path.resolve(rootDir, 'repo');
    writeFiles(rootDir, {
      'repo/.gitignore': 'dist/\n',
      'repo/dist/bundle.ts': '',
      'outside/other.ts': '',
    });
    git(repoDir, 'init');

    const outsideFile = path.resolve(rootDir, 'outside/other.ts');
    const partition = partitionGitignored(repoDir, [
      path.resolve(repoDir, 'dist/bundle.ts'),
      outsideFile,
    ]);

    expect(partition.unfiltered).toBeUndefined();
    expect(partition.kept).toEqual([outsideFile]);
    expect(partition.ignored).toEqual(abs(repoDir, 'dist/bundle.ts'));
  });

  it('fails open outside any git repository', () => {
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-no-repo-'));
    try {
      writeFiles(outsideRepo, { '.gitignore': 'dist/\n', 'dist/bundle.ts': '' });
      const files = abs(outsideRepo, 'dist/bundle.ts');

      const partition = partitionGitignored(outsideRepo, files);

      expect(partition.unfiltered).toBe('no-git-repo');
      expect(partition.kept).toEqual(files);
      expect(partition.ignored).toEqual([]);
    } finally {
      fs.rmSync(outsideRepo, { recursive: true, force: true });
    }
  });

  it('returns empty partitions for an empty file list', () => {
    expect(partitionGitignored(rootDir, [])).toEqual({ kept: [], ignored: [] });
  });
});

describe('sampleIgnoredPaths', () => {
  it('lists rootDir-relative paths and elides the rest', () => {
    const rootDir = '/project';
    const ignored = ['/project/dist/a.ts', '/project/dist/b.ts', '/project/dist/c.ts', '/project/dist/d.ts'];
    expect(sampleIgnoredPaths(rootDir, ignored)).toBe('dist/a.ts, dist/b.ts, dist/c.ts, ...');
    expect(sampleIgnoredPaths(rootDir, ignored.slice(0, 2))).toBe('dist/a.ts, dist/b.ts');
  });
});
