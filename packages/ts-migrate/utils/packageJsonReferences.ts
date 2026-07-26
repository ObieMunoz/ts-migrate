import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import { isJsExtension, JS_EXTENSION_REGEX } from './jsExtensions';
import { JSON5Path, replaceJSON5Strings } from './updateJSON5';

export interface PackageJsonRewrite {
  file: string;
  /** The rewritten field, e.g. `scripts.test` or `jest.testMatch[0]`. */
  key: string;
  from: string;
  to: string;
}

export interface PackageJsonNotice {
  file: string;
  key: string;
  value: string;
  /** The renamed file the value points at. */
  target: string;
}

export interface PackageJsonReferenceResult {
  rewrites: PackageJsonRewrite[];
  notices: PackageJsonNotice[];
}

const GLOB_CHARS = /[*?[{]/;
const BRACED_EXTENSIONS_REGEX = /\.\{([A-Za-z0-9,]+)\}$/;
const PLAIN_EXTENSION_REGEX = /\.([A-Za-z0-9]+)$/;

/**
 * Fields that address the package from the outside. A TypeScript conversion
 * moves what they name to build output, so the renamed source is the wrong
 * target and the rename only reports them.
 */
const ENTRY_POINT_FIELDS = new Set([
  'main',
  'module',
  'browser',
  'bin',
  'exports',
  'types',
  'typings',
  'files',
]);

/** Test runner keys whose values are paths or globs of source files. */
const RUNNER_FIELDS: Record<string, string[]> = {
  jest: [
    'testMatch',
    'collectCoverageFrom',
    'setupFiles',
    'setupFilesAfterEnv',
    'globalSetup',
    'globalTeardown',
  ],
  mocha: ['spec', 'require'],
};

/**
 * Repoints the mechanical package.json references of a rename: the paths and
 * globs in npm scripts and in the jest/mocha config blocks. Only references
 * that resolve to a file in the mapping are rewritten, so build system files
 * kept as JavaScript (`node scripts/build.js`) keep their `.js` path.
 *
 * Entry point fields are reported instead of rewritten. Every edit is a text
 * splice, so formatting and comments outside the edited spans survive.
 */
export function updatePackageJsonReferences(
  rootDir: string,
  renamedFiles: ReadonlyArray<{ oldFile: string; newFile: string }>,
  opts: { dryRun?: boolean } = {},
): PackageJsonReferenceResult {
  const result: PackageJsonReferenceResult = { rewrites: [], notices: [] };
  if (renamedFiles.length === 0) return result;

  const newByOld = new Map<string, string>();
  renamedFiles.forEach(({ oldFile, newFile }) => {
    newByOld.set(path.resolve(oldFile), path.resolve(newFile));
  });
  const walkCache = new Map<string, string[]>();

  /** The tree as it looks once the mapping is applied, whichever side of the rename we are on. */
  const postRenamePaths = (dir: string, pattern: string): string[] =>
    walkFiles(path.resolve(dir, staticPrefix(pattern)), walkCache)
      .map((file) => newByOld.get(file) ?? file)
      .filter((file) => isUnder(dir, file))
      .map((file) => toPosix(path.relative(dir, file)));

  const rewritePath = (value: string, dir: string): string | undefined => {
    const extension = JS_EXTENSION_REGEX.exec(value);
    if (!extension) return undefined;
    const newFile = newByOld.get(resolveReference(dir, value));
    if (!newFile) return undefined;
    return value.slice(0, -extension[0].length) + path.extname(newFile);
  };

  const rewriteGlob = (value: string, dir: string): string | undefined => {
    const { prefix, pattern } = splitRootDir(value);
    const tail = extensionTail(pattern);
    if (!tail || !tail.extensions.some(isJsExtension)) return undefined;

    const matches = globToRegExp(pattern);
    const newExtensions = new Set<string>();
    renamedFiles.forEach(({ oldFile, newFile }) => {
      const resolved = path.resolve(oldFile);
      if (!isUnder(dir, resolved) || !matches.test(toPosix(path.relative(dir, resolved)))) return;
      newExtensions.add(path.extname(newFile).slice(1));
    });
    if (newExtensions.size === 0) return undefined;

    const stillMatching = postRenamePaths(dir, pattern).filter((file) => matches.test(file));
    const kept = tail.extensions.filter(
      (extension) =>
        !isJsExtension(extension) || stillMatching.some((file) => file.endsWith(`.${extension}`)),
    );
    const extensions = [...kept, ...[...newExtensions].sort().filter((e) => !kept.includes(e))];
    if (extensions.join(',') === tail.extensions.join(',')) return undefined;

    const head = pattern.slice(0, tail.start);
    const rendered =
      extensions.length === 1 ? `${head}${extensions[0]}` : `${head}{${extensions.join(',')}}`;
    return prefix + rendered;
  };

  const rewriteReference = (value: string, dir: string): string | undefined => {
    if (GLOB_CHARS.test(value)) return rewriteGlob(value, dir);
    const { prefix, pattern } = splitRootDir(value);
    const rewritten = rewritePath(pattern, dir);
    return rewritten === undefined ? undefined : prefix + rewritten;
  };

  const rewriteCommand = (command: string, dir: string): string | undefined => {
    let changed = false;
    const rewritten = command
      .split(/(\s+)/)
      .map((token) => {
        const { head, body, tail } = splitToken(token);
        if (body.length === 0) return token;
        const replacement = rewriteReference(body, dir);
        if (replacement === undefined) return token;
        changed = true;
        return head + replacement + tail;
      })
      .join('');
    return changed ? rewritten : undefined;
  };

  /** The renamed file an entry point field names, either directly or through a glob. */
  const renamedTarget = (value: string, dir: string): string | undefined => {
    if (!GLOB_CHARS.test(value)) return newByOld.get(resolveReference(dir, value));
    const { pattern } = splitRootDir(value);
    const matches = globToRegExp(pattern);
    return renamedFiles
      .map(({ oldFile, newFile }) => ({ oldFile: path.resolve(oldFile), newFile }))
      .filter(
        ({ oldFile }) => isUnder(dir, oldFile) && matches.test(toPosix(path.relative(dir, oldFile))),
      )
      .map(({ newFile }) => newFile)[0];
  };

  packageJsonFiles(rootDir, renamedFiles).forEach((packageJsonFile) => {
    const dir = path.dirname(packageJsonFile);
    let sourceText: string;
    try {
      sourceText = fs.readFileSync(packageJsonFile, 'utf-8');
    } catch {
      return;
    }

    const rewrites: PackageJsonRewrite[] = [];
    const notices: PackageJsonNotice[] = [];
    let updatedText: string;
    try {
      updatedText = replaceJSON5Strings(sourceText, (keyPath, value) => {
        const file = toPosix(path.relative(rootDir, packageJsonFile));
        const key = formatKeyPath(keyPath);

        if (typeof keyPath[0] === 'string' && ENTRY_POINT_FIELDS.has(keyPath[0])) {
          const target = renamedTarget(value, dir);
          if (target) {
            notices.push({ file, key, value, target: toPosix(path.relative(rootDir, target)) });
          }
          return undefined;
        }

        let replacement: string | undefined;
        if (isScript(keyPath)) {
          replacement = rewriteCommand(value, dir);
        } else if (isRunnerField(keyPath)) {
          replacement = rewriteReference(value, dir);
        }
        if (replacement === undefined) return undefined;
        rewrites.push({ file, key, from: value, to: replacement });
        return replacement;
      });
    } catch (err) {
      log.warn(
        `Could not update the references in ${toPosix(path.relative(rootDir, packageJsonFile))}:`,
        err,
      );
      return;
    }

    result.rewrites.push(...rewrites);
    result.notices.push(...notices);
    if (updatedText !== sourceText && !opts.dryRun) {
      fs.writeFileSync(packageJsonFile, updatedText, 'utf-8');
    }
  });

  return result;
}

/** The standard notices for what the rename changed and what it deliberately left. */
export function logPackageJsonReferences(
  result: PackageJsonReferenceResult,
  dryRun?: boolean,
): void {
  if (result.rewrites.length > 0) {
    const lines = result.rewrites.map(
      ({ file, key, from, to }) =>
        `  ${file} ${key}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
    );
    log.info(
      `${dryRun ? 'Dry run: would update' : 'Updated'} ${result.rewrites.length} package.json ` +
        `reference(s) to renamed files:\n${lines.join('\n')}`,
    );
  }

  if (result.notices.length > 0) {
    const lines = result.notices.map(
      ({ file, key, value, target }) =>
        `  ${file} ${key}: ${JSON.stringify(value)} (now ${target})`,
    );
    log.info(
      `Left ${result.notices.length} package.json entry point(s) alone. They point at renamed ` +
        `files, and after a TypeScript conversion they need to name build output rather than ` +
        `the source:\n${lines.join('\n')}\n` +
        `Add a build step (tsc) or a TypeScript aware runner, then point them at its output.`,
    );
  }
}

function isScript(keyPath: JSON5Path): boolean {
  return keyPath.length === 2 && keyPath[0] === 'scripts' && typeof keyPath[1] === 'string';
}

function isRunnerField(keyPath: JSON5Path): boolean {
  const [root, field] = keyPath;
  if (typeof root !== 'string' || typeof field !== 'string') return false;
  if (!(root in RUNNER_FIELDS) || !RUNNER_FIELDS[root].includes(field)) return false;
  return keyPath.length === 2 || (keyPath.length === 3 && typeof keyPath[2] === 'number');
}

function formatKeyPath(keyPath: JSON5Path): string {
  return keyPath
    .map((key, i) => {
      if (typeof key === 'number') return `[${key}]`;
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) return `[${JSON.stringify(key)}]`;
      return i === 0 ? key : `.${key}`;
    })
    .join('');
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isUnder(parentDir: string, candidate: string): boolean {
  const rel = path.relative(parentDir, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Jest addresses its config paths from `<rootDir>`, which is the package.json directory. */
function splitRootDir(value: string): { prefix: string; pattern: string } {
  const match = /^<rootDir>\/?/.exec(value);
  if (!match) return { prefix: '', pattern: value };
  return { prefix: match[0], pattern: value.slice(match[0].length) };
}

function resolveReference(dir: string, value: string): string {
  return path.resolve(dir, value);
}

/** A command token split into its flag prefix, the path or glob, and any closing quote. */
function splitToken(token: string): { head: string; body: string; tail: string } {
  const equals = token.indexOf('=');
  let head = equals === -1 ? '' : token.slice(0, equals + 1);
  let body = token.slice(head.length);
  let tail = '';
  const quote = body[0];
  if ((quote === "'" || quote === '"') && body.length > 1 && body.endsWith(quote)) {
    head += quote;
    tail = quote;
    body = body.slice(1, -1);
  }
  return { head, body, tail };
}

/** The extension part a glob ends with, as `.ts` or as a `.{js,jsx}` brace group. */
function extensionTail(pattern: string): { start: number; extensions: string[] } | undefined {
  const braced = BRACED_EXTENSIONS_REGEX.exec(pattern);
  if (braced) {
    return { start: braced.index + 1, extensions: braced[1].split(',').filter(Boolean) };
  }
  const plain = PLAIN_EXTENSION_REGEX.exec(pattern);
  return plain ? { start: plain.index + 1, extensions: [plain[1]] } : undefined;
}

/** The directory a glob can only match inside, relative to the package.json directory. */
function staticPrefix(pattern: string): string {
  const globAt = pattern.search(GLOB_CHARS);
  const head = globAt === -1 ? pattern : pattern.slice(0, globAt);
  const slash = head.lastIndexOf('/');
  return slash === -1 ? '.' : head.slice(0, slash);
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/^\.\//, '');
  let source = '';
  let braceDepth = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        while (normalized[i + 1] === '*') i += 1;
        if (normalized[i + 1] === '/') {
          source += '(?:[^/]+/)*';
          i += 1;
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else if (ch === '{') {
      braceDepth += 1;
      source += '(?:';
    } else if (ch === '}' && braceDepth > 0) {
      braceDepth -= 1;
      source += ')';
    } else if (ch === ',' && braceDepth > 0) {
      source += '|';
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

function walkFiles(root: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(root);
  if (cached) return cached;

  const files: string[] = [];
  const queue = [root];
  for (let i = 0; i < queue.length; i += 1) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(queue[i], { withFileTypes: true });
    } catch {
      entries = [];
    }
    entries.forEach((entry) => {
      const full = path.join(queue[i], entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) queue.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    });
  }

  cache.set(root, files);
  return files;
}

/** Every package.json from the directory of a renamed file up to rootDir. */
function packageJsonFiles(
  rootDir: string,
  renamedFiles: ReadonlyArray<{ oldFile: string }>,
): string[] {
  const root = path.resolve(rootDir);
  const dirs = new Set<string>([root]);
  renamedFiles.forEach(({ oldFile }) => {
    let dir = path.dirname(path.resolve(oldFile));
    while (dir !== root && isUnder(root, dir) && !dirs.has(dir)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  });
  return [...dirs]
    .map((dir) => path.join(dir, 'package.json'))
    .filter((file) => fs.existsSync(file))
    .sort();
}
