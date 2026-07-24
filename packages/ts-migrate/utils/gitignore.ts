import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';

export interface GitignorePartition {
  kept: string[];
  ignored: string[];
  /** Set when no filtering happened, with the reason the rules were not applied. */
  unfiltered?: 'no-git-repo' | 'root-dir-ignored' | 'git-error';
}

// A monorepo can put six figures of paths through one batch; the default
// 1MB maxBuffer would truncate the response mid-path.
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

function runGit(
  cwd: string,
  args: string[],
  input?: string,
): { status: number; stdout: string } | null {
  const result = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf-8',
    maxBuffer: MAX_GIT_BUFFER,
  });
  if (result.error || result.status === null) {
    return null;
  }
  return { status: result.status, stdout: result.stdout };
}

function isUnder(parentDir: string, candidate: string): boolean {
  const rel = path.relative(parentDir, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Splits files into the ones git would keep and the ones it ignores, using
 * the repository containing rootDir as the oracle (`git check-ignore`), so
 * nested .gitignore files, negations, global excludes, and tracked files
 * that happen to match a pattern all behave exactly as they do for git.
 *
 * Fails open: without git or a repository nothing is filtered, and when
 * rootDir itself is ignored (a scratch checkout inside a larger repo) its
 * rules say nothing useful about the files within, so filtering is disabled.
 */
export function partitionGitignored(rootDir: string, files: string[]): GitignorePartition {
  if (files.length === 0) {
    return { kept: [], ignored: [] };
  }

  const toplevelResult = runGit(rootDir, ['rev-parse', '--show-toplevel']);
  if (!toplevelResult || toplevelResult.status !== 0) {
    return { kept: [...files], ignored: [], unfiltered: 'no-git-repo' };
  }
  const toplevel = toplevelResult.stdout.trim();

  // rev-parse answers with a fully resolved path; resolve rootDir the same
  // way so the containment checks below compare like with like.
  let realRootDir: string;
  try {
    realRootDir = fs.realpathSync(rootDir);
  } catch {
    realRootDir = path.resolve(rootDir);
  }

  if (realRootDir !== toplevel && isUnder(toplevel, realRootDir)) {
    const rootCheck = runGit(toplevel, [
      'check-ignore',
      '-q',
      '--',
      path.relative(toplevel, realRootDir),
    ]);
    if (!rootCheck) {
      return { kept: [...files], ignored: [], unfiltered: 'git-error' };
    }
    if (rootCheck.status === 0) {
      return { kept: [...files], ignored: [], unfiltered: 'root-dir-ignored' };
    }
  }

  // check-ignore aborts its whole batch on a path outside the repository, so
  // those paths (never governed by this repository's rules) stay out of it.
  const kept: string[] = [];
  const fileByRelPath = new Map<string, string>();
  files.forEach((file) => {
    const resolved = path.resolve(realRootDir, path.relative(rootDir, file));
    if (!isUnder(toplevel, resolved)) {
      kept.push(file);
      return;
    }
    fileByRelPath.set(path.relative(toplevel, resolved).split(path.sep).join('/'), file);
  });

  if (fileByRelPath.size === 0) {
    return { kept, ignored: [] };
  }

  const batch = runGit(
    toplevel,
    ['check-ignore', '--stdin', '-z'],
    [...fileByRelPath.keys()].join('\0'),
  );
  // Exit 1 means no path was ignored; anything else unexpected fails open.
  if (!batch || (batch.status !== 0 && batch.status !== 1)) {
    return { kept: [...files], ignored: [], unfiltered: 'git-error' };
  }

  const ignored: string[] = [];
  const ignoredRelPaths = new Set(batch.stdout.split('\0').filter(Boolean));
  fileByRelPath.forEach((file, relPath) => {
    if (ignoredRelPaths.has(relPath)) {
      ignored.push(file);
    } else {
      kept.push(file);
    }
  });
  return { kept, ignored };
}

/**
 * The gitignored directories inside rootDir, as sorted rootDir-relative
 * paths with forward slashes. Whole ignored trees collapse to their topmost
 * directory (`git status --ignored` semantics); individually ignored files
 * are not reported. Empty without git or a repository.
 */
export function listGitignoredDirectories(rootDir: string): string[] {
  const status = runGit(rootDir, ['status', '--porcelain=v1', '-z', '--ignored', '--', '.']);
  if (!status || status.status !== 0) {
    return [];
  }
  const toplevelResult = runGit(rootDir, ['rev-parse', '--show-toplevel']);
  if (!toplevelResult || toplevelResult.status !== 0) {
    return [];
  }
  const toplevel = toplevelResult.stdout.trim();
  let realRootDir: string;
  try {
    realRootDir = fs.realpathSync(rootDir);
  } catch {
    realRootDir = path.resolve(rootDir);
  }

  const directories = new Set<string>();
  status.stdout.split('\0').forEach((entry) => {
    // Porcelain v1 paths are toplevel-relative regardless of the cwd.
    if (!entry.startsWith('!! ') || !entry.endsWith('/')) {
      return;
    }
    const resolved = path.resolve(toplevel, entry.slice(3));
    if (resolved === realRootDir || !isUnder(realRootDir, resolved)) {
      return;
    }
    directories.add(path.relative(realRootDir, resolved).split(path.sep).join('/'));
  });
  return [...directories].sort();
}

/** Up to max rootDir-relative sample paths, for log messages about a partition. */
export function sampleIgnoredPaths(
  rootDir: string,
  ignored: string[],
  max = 3,
): string {
  const samples = ignored
    .slice(0, max)
    .map((file) => path.relative(rootDir, file).split(path.sep).join('/'));
  if (ignored.length > max) {
    samples.push('...');
  }
  return samples.join(', ');
}

/** The standard notice for a partition that skipped filtering; silent otherwise. */
export function logUnfilteredReason(rootDir: string, partition: GitignorePartition): void {
  if (partition.unfiltered === 'root-dir-ignored') {
    log.info(`${rootDir} is itself gitignored; gitignore filtering is disabled for this run.`);
  }
}

export interface MigrationFileFilter {
  filterMigrationFiles: (fileNames: string[]) => string[];
  /** The files dropped so far; complete once the migration is past program setup. */
  skippedFiles: () => string[];
}

/**
 * The migrate/reignore hookup of the partition: a filter for the server's
 * filterMigrationFiles param that drops gitignored files and logs what it
 * dropped, plus access to the dropped list for the run summary.
 */
export function createGitignoreMigrationFilter(rootDir: string): MigrationFileFilter {
  const skipped: string[] = [];
  return {
    filterMigrationFiles: (fileNames) => {
      const partition = partitionGitignored(rootDir, fileNames);
      logUnfilteredReason(rootDir, partition);
      if (partition.ignored.length > 0) {
        skipped.push(...partition.ignored);
        log.info(
          `Skipping ${partition.ignored.length} gitignored file(s) ` +
            `(${sampleIgnoredPaths(rootDir, partition.ignored)}). They stay unmigrated and ` +
            `outside the program; add them to the tsconfig "exclude" so your own tsc skips ` +
            `them too, or pass --no-gitignore to migrate them.`,
        );
      }
      return partition.kept;
    },
    skippedFiles: () => skipped,
  };
}
