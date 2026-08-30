import fs from 'fs';
import path from 'path';

/**
 * `rootDir` and its ancestors up to and including the repository root: a
 * monorepo declares the shared toolchain in either place, and the compiler and
 * ESLint both read a configuration above a folder as governing that folder.
 * Above the checkout is this machine, where anything found is evidence about
 * this machine rather than about the project.
 */
export function directoriesToRepoRoot(rootDir: string): string[] {
  const dirs: string[] = [];
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return dirs;
  }
}
