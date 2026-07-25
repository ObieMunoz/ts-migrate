import fs from 'fs';
import path from 'path';

/** The version at `packageDir`, when a package.json there names `name`. */
export function readPackageVersion(packageDir: string, name: string): string | undefined {
  try {
    const { name: packageName, version } = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'),
    );
    return packageName === name && typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The copy of `name` a program rooted at `rootDir` would load: an explicit
 * walk up the `node_modules` chain rather than require.resolve, whose global
 * fallbacks (NODE_PATH, global installs) can name a copy the project itself
 * would never load.
 *
 * ts-migrate's `utils/resolveTypeScript.ts` walks the same shape for the
 * compiler and stays separate from this one. It installs the
 * `require('typescript')` redirect before anything in the process loads a
 * compiler, so it can import nothing that might pull one in, and ts-migrate
 * depends on this package rather than the other way round, so it could not
 * import this file even if that were free. The duplication is the price of
 * both.
 */
export function resolvePackageFrom(
  rootDir: string,
  name: string,
): { packageDir: string; version: string } | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', name);
    const version = readPackageVersion(packageDir, name);
    if (version) return { packageDir, version };
    if (path.dirname(dir) === dir) return undefined;
  }
}
