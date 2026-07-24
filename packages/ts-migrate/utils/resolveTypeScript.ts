import fs from 'fs';
import Module from 'module';
import path from 'path';

/**
 * Every suppression a migration writes is derived from what its own compiler
 * reports, so the compiler has to be the one the project itself runs. Under
 * `npx` it is not: the peer dependency is resolved in a temporary directory
 * and npm picks the highest version the range allows, which then disagrees
 * with the project's tsc about which errors exist.
 */
export interface TypeScriptDecision {
  /** Directory of the typescript package to load: the folder holding its package.json. */
  packageDir: string;
  version: string;
  source: 'override' | 'project' | 'bundled';
  /** A project compiler that was found but not used, and why. */
  refused?: { packageDir: string; version: string; reason: string };
}

// The range the three packages declare as their typescript peer dependency.
// A project compiler outside it is refused rather than loaded: the plugins
// call compiler APIs this repo only tests within these majors.
const SUPPORTED_MAJORS = { min: 5, maxExclusive: 7 };
export const SUPPORTED_RANGE = `>=${SUPPORTED_MAJORS.min}.0 <${SUPPORTED_MAJORS.maxExclusive}`;

function isSupportedVersion(version: string): boolean {
  const major = Number.parseInt(version, 10);
  return (
    Number.isInteger(major) &&
    major >= SUPPORTED_MAJORS.min &&
    major < SUPPORTED_MAJORS.maxExclusive
  );
}

function readPackageVersion(packageDir: string): string | undefined {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'),
    );
    return packageJson.name === 'typescript' && typeof packageJson.version === 'string'
      ? packageJson.version
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The compiler the project's own tsc would load: an explicit ancestor walk
 * rather than require.resolve, whose global fallbacks (NODE_PATH, global
 * installs) can name a typescript the project itself would never load.
 */
export function findProjectTypeScript(
  rootDir: string,
): { packageDir: string; version: string } | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', 'typescript');
    const version = readPackageVersion(packageDir);
    if (version) return { packageDir, version };
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The compiler installed alongside ts-migrate, used when the project has none. */
export function findBundledTypeScript(): { packageDir: string; version: string } {
  // Resolved from this file, and only ever before the redirect below is
  // installed, so it names ts-migrate's own peer install.
  const packageDir = path.dirname(
    Module.createRequire(__filename).resolve('typescript/package.json'),
  );
  const version = readPackageVersion(packageDir);
  if (!version) {
    throw new Error(`Could not read the TypeScript version at ${packageDir}.`);
  }
  return { packageDir, version };
}

/**
 * Accepts a path to a typescript package directory, or to any file inside
 * one (`node_modules/typescript/lib/typescript.js`, a `tsc` bin script).
 */
export function readTypeScriptOverride(overridePath: string): {
  packageDir: string;
  version: string;
} {
  const resolved = path.resolve(overridePath);
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    const version = readPackageVersion(dir);
    if (version) return { packageDir: dir, version };
    if (path.dirname(dir) === dir) {
      throw new Error(
        `--typescript ${overridePath} does not point at a typescript package ` +
          `(no package.json named "typescript" at or above ${resolved}).`,
      );
    }
  }
}

export function resolveTypeScript({
  rootDir,
  override,
}: {
  rootDir: string;
  override?: string;
}): TypeScriptDecision {
  if (override) {
    return { ...readTypeScriptOverride(override), source: 'override' };
  }

  const project = findProjectTypeScript(rootDir);
  if (project && isSupportedVersion(project.version)) {
    return { ...project, source: 'project' };
  }

  const bundled = findBundledTypeScript();
  return {
    ...bundled,
    source: 'bundled',
    refused: project
      ? { ...project, reason: `outside the range ts-migrate supports (${SUPPORTED_RANGE})` }
      : undefined,
  };
}

/** The run banner: which compiler was chosen, and why it was that one. */
export function describeTypeScript(decision: TypeScriptDecision, version = decision.version) {
  switch (decision.source) {
    case 'override':
      return `TypeScript ${version} (--typescript ${decision.packageDir})`;
    case 'project':
      return `TypeScript ${version} (project: ${decision.packageDir})`;
    default:
      return (
        `TypeScript ${version} (bundled with ts-migrate; ` +
        `${
          decision.refused
            ? `project has typescript ${decision.refused.version}, ${decision.refused.reason}`
            : 'project has no typescript installed'
        })`
      );
  }
}

/** The warning that belongs with the banner, when the choice is a compromise. */
export function typeScriptWarning(decision: TypeScriptDecision): string | undefined {
  if (decision.refused) {
    return (
      `This project has typescript ${decision.refused.version} installed, which is ` +
      `${decision.refused.reason}; using the TypeScript ${decision.version} bundled with ` +
      `ts-migrate instead. The suppressions added here may not match what the project's ` +
      `own tsc reports.`
    );
  }
  if (decision.source === 'bundled') {
    return (
      `This project has no typescript installed, so the TypeScript ${decision.version} ` +
      `bundled with ts-migrate is used. Install typescript in the project to make sure ` +
      `the suppressions added here match what its own tsc reports.`
    );
  }
  if (decision.source === 'override' && !isSupportedVersion(decision.version)) {
    return (
      `--typescript names TypeScript ${decision.version}, outside the range ts-migrate ` +
      `supports (${SUPPORTED_RANGE}). Continuing as asked.`
    );
  }
  return undefined;
}

type ResolveFilename = (request: string, ...rest: any[]) => string;

/**
 * Points every `require('typescript')` in the process at packageDir. The
 * three packages import the compiler at module scope in 34 files, so it
 * cannot be chosen per call site. One instance is the requirement, not an
 * optimization: two compiler copies in one process is what produced the
 * SyntaxKind numbering breakage this repo carries a canary test for.
 *
 * Covers the CommonJS graph the CLI and its packages are; an ESM `import` of
 * typescript goes through the module loader instead and resolves on its own.
 */
export function installTypeScriptResolution(packageDir: string): void {
  const moduleApi = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = moduleApi._resolveFilename;
  moduleApi._resolveFilename = function resolveFilename(
    this: unknown,
    request: string,
    ...rest: any[]
  ) {
    if (request === 'typescript' || request.startsWith('typescript/')) {
      // An absolute path resolves through main/index and file extensions the
      // same way the bare specifier would, from the chosen directory.
      const target =
        request === 'typescript'
          ? packageDir
          : path.join(packageDir, request.slice('typescript/'.length));
      try {
        return originalResolveFilename.call(this, target, ...rest);
      } catch {
        // A subpath this copy does not have: let the default resolution
        // produce the error the caller would otherwise have seen.
      }
    }
    return originalResolveFilename.call(this, request, ...rest);
  };
}

/**
 * The migration root of a CLI invocation, read from raw argv because the
 * redirect has to be installed before yargs (and every import that loads a
 * compiler) runs. The commands take a single `<folder>` positional; the value
 * of an option can look positional too, so a directory holding a tsconfig
 * wins over one that merely exists.
 */
export function migrationRootFromArgv(argv: string[], cwd: string): string {
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--typescript') {
      i += 1;
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }
  const isDirectory = (candidate: string) => {
    try {
      return fs.statSync(path.resolve(cwd, candidate)).isDirectory();
    } catch {
      return false;
    }
  };
  // The first positional is the command name.
  const directories = positionals.slice(1).filter(isDirectory);
  const folder =
    directories.find((candidate) => fs.existsSync(path.resolve(cwd, candidate, 'tsconfig.json'))) ??
    directories[0];
  return path.resolve(cwd, folder ?? '.');
}

export function typeScriptOverrideFromArgv(argv: string[]): string | undefined {
  const index = argv.indexOf('--typescript');
  if (index !== -1) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith('--typescript='));
  return inline ? inline.slice('--typescript='.length) : undefined;
}
