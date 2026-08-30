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
  /**
   * The project's own compiler when `--typescript` took its place and the two
   * disagree about diagnostics. A refused compiler is reported through
   * `refused` instead; this field is only about a skew the user asked for.
   */
  skew?: { packageDir: string; version: string };
}

// The range the three packages declare as their typescript peer dependency.
// A project compiler outside it is refused rather than loaded: the plugins call
// compiler APIs this repo only tests here. The floor is a minor and a patch,
// not a major. TypeScript renumbers SyntaxKind between minor releases, which
// makes a codemod misread the AST rather than fail, so "some 5.x" is not a
// claim anything can stand behind; 5.7.3 is the oldest compiler CI builds.
const SUPPORTED_MIN = { major: 5, minor: 7, patch: 3 };
const SUPPORTED_MAX_EXCLUSIVE_MAJOR = 7;
export const SUPPORTED_RANGE =
  `>=${SUPPORTED_MIN.major}.${SUPPORTED_MIN.minor}.${SUPPORTED_MIN.patch} ` +
  `<${SUPPORTED_MAX_EXCLUSIVE_MAJOR}`;

function isSupportedVersion(version: string): boolean {
  // Leading-anchored so a prerelease suffix (`5.9.0-dev.20260101`) reads as the
  // release it precedes rather than failing to parse.
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed.slice(1).map(Number);
  if (major >= SUPPORTED_MAX_EXCLUSIVE_MAJOR) return false;
  if (major !== SUPPORTED_MIN.major) return major > SUPPORTED_MIN.major;
  if (minor !== SUPPORTED_MIN.minor) return minor > SUPPORTED_MIN.minor;
  return patch >= SUPPORTED_MIN.patch;
}

/**
 * Whether two compilers report the same diagnostics. TypeScript's checker
 * moves in every minor release, so a minor apart is enough for one to call a
 * suppression the other needed unused (TS2578); patch releases are fixes that
 * do not move diagnostics, so `5.7.2` against `5.7.3` counts as the same.
 */
export function isSameCheckerVersion(a: string, b: string): boolean {
  const majorMinor = (version: string) => version.split('.', 2).join('.');
  return majorMinor(a) === majorMinor(b);
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
 *
 * ts-migrate-plugins has the same walk as a shared helper
 * (`src/utils/resolvePackageFrom.ts`) and this one stays separate from it.
 * `installTypeScriptResolution` below has to run before anything in the
 * process loads a compiler, so this file imports nothing outside node
 * builtins, and ts-migrate depends on that package rather than the other way
 * round, so it could not import the helper even if that were free.
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
function findBundledTypeScript(): { packageDir: string; version: string } {
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
    const chosen = readTypeScriptOverride(override);
    const installed = findProjectTypeScript(rootDir);
    return {
      ...chosen,
      source: 'override',
      skew:
        installed && !isSameCheckerVersion(installed.version, chosen.version)
          ? installed
          : undefined,
    };
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

/**
 * The warning that belongs with the banner, when the choice is a compromise.
 * Names the path of every compiler it mentions: a version pair alone does not
 * say which install is which, and the one that is not the project's usually
 * lives in an npx cache directory nobody would guess.
 */
export function typeScriptWarning(decision: TypeScriptDecision): string | undefined {
  if (decision.refused) {
    return (
      `This project has typescript ${decision.refused.version} installed ` +
      `(${decision.refused.packageDir}), which is ${decision.refused.reason}; using the ` +
      `TypeScript ${decision.version} bundled with ts-migrate instead (${decision.packageDir}). ` +
      `The suppressions added here are the ones ${decision.version} reports, so the project's ` +
      `own tsc may report them as unused (TS2578).`
    );
  }
  if (decision.source === 'bundled') {
    return (
      `This project has no typescript installed, so the TypeScript ${decision.version} ` +
      `bundled with ts-migrate is used (${decision.packageDir}). Install typescript in the ` +
      `project to make sure the suppressions added here match what its own tsc reports.`
    );
  }
  const warnings: string[] = [];
  if (decision.source === 'override' && !isSupportedVersion(decision.version)) {
    warnings.push(
      `--typescript names TypeScript ${decision.version}, outside the range ts-migrate ` +
        `supports (${SUPPORTED_RANGE}). Continuing as asked.`,
    );
  }
  if (decision.skew) {
    warnings.push(
      `--typescript names TypeScript ${decision.version} (${decision.packageDir}), and this ` +
        `project has typescript ${decision.skew.version} installed (${decision.skew.packageDir}). ` +
        `TypeScript's checker changes in every minor release, so the suppressions added here are ` +
        `the ones ${decision.version} reports and the project's own tsc may report them as ` +
        `unused (TS2578). Align the two compilers first: reignore under the same skew re-derives ` +
        `the same suppressions.`,
    );
  }
  return warnings.length > 0 ? warnings.join(' ') : undefined;
}

/**
 * The mismatch between the compiler a migration reasons with and the one a
 * later `tsc` run checks its work with. Undefined when the two agree.
 */
export function checkerSkewWarning(
  migration: { version: string; packageDir: string },
  check: { version: string; path: string },
): string | undefined {
  if (isSameCheckerVersion(migration.version, check.version)) return undefined;
  let checkPackageDir: string | undefined;
  try {
    checkPackageDir = readTypeScriptOverride(check.path).packageDir;
  } catch {
    // A tsc outside a typescript package (a wrapper script, a global shim):
    // it can still check, it just cannot be named as a --typescript value.
  }
  return (
    `The check would run TypeScript ${check.version} (${check.path}), and the migration runs ` +
    `TypeScript ${migration.version} (${migration.packageDir}). TypeScript's checker changes ` +
    `in every minor release, so the check reports suppressions the migration needed as unused ` +
    `(TS2578), and reignore does not converge: it re-derives them from the migration's ` +
    `compiler every time.\n` +
    `Align the two before starting: leave the custom tsc path empty to check with ` +
    `${migration.packageDir}` +
    (checkPackageDir ? `, or migrate with --typescript ${checkPackageDir}` : '') +
    `.`
  );
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
