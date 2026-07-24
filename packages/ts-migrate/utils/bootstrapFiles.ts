import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import { collectModuleSpecifiers } from '@obiemunoz/ts-migrate-plugins';
import { sampleIgnoredPaths } from './gitignore';

export interface BootstrapFile {
  file: string;
  /** Human-readable evidence, with rootDir-relative paths. */
  reason: string;
}

export interface SharedBootstrapImport {
  file: string;
  reason: string;
  /** Kept files that import the bootstrap file. */
  importers: string[];
}

export interface ApplicationEntry {
  file: string;
  reason: string;
  closureSize: number;
  candidateCount: number;
}

export interface BootstrapPartition {
  kept: string[];
  bootstrap: BootstrapFile[];
  /**
   * Detected files whose require tree was too large to keep: the file itself
   * stays bootstrap, the tree migrates as application code.
   */
  applicationEntries: ApplicationEntry[];
  /** Only filled with detectSharedImporters: bootstrap files the kept side imports. */
  shared: SharedBootstrapImport[];
}

// The extension is stripped before matching names so the .cjs/.mjs support
// of the rename command can reuse the table when it arrives.
const JS_EXTENSION_REGEX = /\.[cm]?jsx?$/;

function isKnownConfigName(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (!JS_EXTENSION_REGEX.test(base)) return false;
  const name = base.replace(JS_EXTENSION_REGEX, '');
  return (
    name.endsWith('.config') ||
    name.endsWith('.conf') ||
    name === 'gulpfile' ||
    name === 'gruntfile' ||
    /^\..*rc$/.test(name)
  );
}

const SCRIPT_SEPARATORS = new Set(['&&', '||', ';', '|', '&']);

// A detected file's require tree larger than this (and than half the project)
// marks an application entry rather than build tooling.
const APPLICATION_TREE_MIN = 8;

/**
 * The .js paths a script command hands to `node`, in the token stretch
 * between a `node` token and the next command separator. Preload arguments
 * (`-r ./register.js`) and file arguments of the invoked script are included:
 * every one of them is read by a plain Node process at run time.
 */
function nodeScriptPaths(command: string): string[] {
  const paths: string[] = [];
  let afterNode = false;
  command.split(/\s+/).forEach((token) => {
    const bare = token.replace(/^['"]/, '').replace(/['"]$/, '');
    if (bare.length === 0) return;
    if (SCRIPT_SEPARATORS.has(bare)) {
      afterNode = false;
      return;
    }
    if (bare === 'node') {
      afterNode = true;
      return;
    }
    if (!afterNode) return;
    const value = bare.includes('=') ? bare.slice(bare.indexOf('=') + 1) : bare;
    if (JS_EXTENSION_REGEX.test(value) && !value.split(/[\\/]/).includes('node_modules')) {
      paths.push(value);
    }
  });
  return paths;
}

function relativeTo(rootDir: string, file: string): string {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

function readPackageJson(dir: string): { scripts?: Record<string, unknown> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function isUnder(parentDir: string, candidate: string): boolean {
  const rel = path.relative(parentDir, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** Every directory holding a candidate, all their ancestors up to rootDir, and rootDir. */
function candidateDirectories(rootDir: string, candidates: string[]): string[] {
  const root = path.resolve(rootDir);
  const dirs = new Set<string>([root]);
  candidates.forEach((file) => {
    let dir = path.dirname(file);
    while (isUnder(root, dir) && !dirs.has(dir)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  });
  return [...dirs];
}

/**
 * The candidate files a file references through relative import/require
 * string literals, resolved the way plain Node would (exact path, then
 * .js/.jsx, then index.js/index.jsx).
 */
function createDependencyReader(candidateSet: Set<string>) {
  const cache = new Map<string, string[]>();
  return (file: string): string[] => {
    const cached = cache.get(file);
    if (cached) return cached;

    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      cache.set(file, []);
      return [];
    }
    // JSX kind so app files with JSX parse cleanly; plain JS parses the same.
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JSX);
    const dependencies: string[] = [];
    collectModuleSpecifiers(sourceFile).forEach((literal) => {
      const specifier = literal.text;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
      const base = path.resolve(path.dirname(file), specifier);
      const targets = JS_EXTENSION_REGEX.test(specifier)
        ? [base]
        : [`${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')];
      const resolved = targets.find((target) => candidateSet.has(target));
      if (resolved !== undefined && !dependencies.includes(resolved)) {
        dependencies.push(resolved);
      }
    });
    cache.set(file, dependencies);
    return dependencies;
  };
}

/**
 * Splits files into the ones to migrate and the bootstrap files that must
 * keep running under plain Node: the configs and scripts a build loads before
 * any compile step exists (webpack.config.js, `node scripts/build.js`).
 * Detection, in order of confidence:
 *
 * 1. Known config names in a directory that holds a package.json.
 * 2. Paths a package.json script runs with `node`.
 * 3. Files the detected ones reach through relative require/import literals.
 *
 * Build tool chains are shallow, so a detected file whose require tree spans
 * more than half the project (or APPLICATION_TREE_MIN files, whichever is
 * larger) is treated as an application entry instead: something like
 * `"start": "node server.js"` names the application itself, which the
 * migration exists to convert. The entry keeps its direct evidence and stays
 * bootstrap; its tree migrates normally.
 */
export function partitionBootstrapFiles(
  rootDir: string,
  files: string[],
  opts: { detectSharedImporters?: boolean } = {},
): BootstrapPartition {
  const fileByResolved = new Map<string, string>();
  files.forEach((file) => {
    fileByResolved.set(path.resolve(file), file);
  });
  const candidateSet = new Set(fileByResolved.keys());
  const readDependencies = createDependencyReader(candidateSet);

  const reasons = new Map<string, string>();
  candidateSet.forEach((file) => {
    if (isKnownConfigName(file) && fs.existsSync(path.join(path.dirname(file), 'package.json'))) {
      reasons.set(file, 'config file next to a package.json');
    }
  });

  candidateDirectories(rootDir, [...candidateSet]).forEach((dir) => {
    const packageJson = readPackageJson(dir);
    if (!packageJson || typeof packageJson.scripts !== 'object' || packageJson.scripts === null) {
      return;
    }
    Object.entries(packageJson.scripts).forEach(([scriptName, command]) => {
      if (typeof command !== 'string') return;
      nodeScriptPaths(command).forEach((scriptPath) => {
        const resolved = path.resolve(dir, scriptPath);
        if (!candidateSet.has(resolved) || reasons.has(resolved)) return;
        reasons.set(
          resolved,
          `run with node by the "${scriptName}" script in ${relativeTo(
            rootDir,
            path.join(dir, 'package.json'),
          )}`,
        );
      });
    });
  });

  const closureLimit = Math.max(APPLICATION_TREE_MIN, candidateSet.size / 2);
  const applicationEntries: ApplicationEntry[] = [];
  const closureReasons = new Map<string, string>();
  reasons.forEach((reason, seed) => {
    const visited = new Set([seed]);
    const chain = new Map<string, string>();
    const queue = [seed];
    for (let i = 0; i < queue.length; i += 1) {
      const file = queue[i];
      readDependencies(file).forEach((dependency) => {
        if (visited.has(dependency) || reasons.has(dependency)) return;
        visited.add(dependency);
        chain.set(dependency, file);
        queue.push(dependency);
      });
    }

    const closureSize = visited.size - 1;
    if (closureSize > closureLimit) {
      applicationEntries.push({
        file: seed,
        reason,
        closureSize,
        candidateCount: candidateSet.size,
      });
      return;
    }
    chain.forEach((parent, file) => {
      if (!closureReasons.has(file)) {
        closureReasons.set(file, `required by ${relativeTo(rootDir, parent)}`);
      }
    });
  });
  closureReasons.forEach((reason, file) => {
    if (!reasons.has(file)) reasons.set(file, reason);
  });

  const kept: string[] = [];
  const bootstrap: BootstrapFile[] = [];
  fileByResolved.forEach((original, resolved) => {
    const reason = reasons.get(resolved);
    if (reason !== undefined) {
      bootstrap.push({ file: original, reason });
    } else {
      kept.push(original);
    }
  });

  const shared: SharedBootstrapImport[] = [];
  if (opts.detectSharedImporters && bootstrap.length > 0) {
    const importersByFile = new Map<string, string[]>();
    kept.forEach((file) => {
      readDependencies(path.resolve(file)).forEach((dependency) => {
        if (!reasons.has(dependency)) return;
        const importers = importersByFile.get(dependency) ?? [];
        importers.push(file);
        importersByFile.set(dependency, importers);
      });
    });
    bootstrap.forEach(({ file, reason }) => {
      const importers = importersByFile.get(path.resolve(file));
      if (importers) shared.push({ file, reason, importers });
    });
  }

  return { kept, bootstrap, applicationEntries, shared };
}

/** The standard notices for detected files whose require tree was not kept. */
export function logApplicationEntries(rootDir: string, entries: ApplicationEntry[]): void {
  entries.forEach(({ file, reason, closureSize, candidateCount }) => {
    log.info(
      `Keeping only ${relativeTo(rootDir, file)} as JavaScript (${reason}): its require tree ` +
        `spans ${closureSize} of ${candidateCount} JS file(s), so the tree is treated as ` +
        `application code and stays in the migration.`,
    );
  });
}

/** The standard warnings for bootstrap files the kept side also imports. */
export function logSharedBootstrapImports(rootDir: string, shared: SharedBootstrapImport[]): void {
  shared.forEach(({ file, reason, importers }) => {
    log.warn(
      `${relativeTo(rootDir, file)} stays JavaScript (${reason}) but ` +
        `${sampleIgnoredPaths(rootDir, importers)} import(s) it. The TypeScript side needs ` +
        `"allowJs" until the file is migrated or the shared code is split out.`,
    );
  });
}

export interface BootstrapMigrationFilter {
  filterMigrationFiles: (fileNames: string[]) => string[];
  /** The files dropped so far; complete once the migration is past program setup. */
  skippedFiles: () => BootstrapFile[];
}

/**
 * The migrate/reignore hookup of the partition: drops bootstrap files before
 * they join the program, so they stay JavaScript even under a hand-written
 * tsconfig with allowJs that includes them.
 */
export function createBootstrapMigrationFilter(rootDir: string): BootstrapMigrationFilter {
  const skipped: BootstrapFile[] = [];
  return {
    filterMigrationFiles: (fileNames) => {
      const partition = partitionBootstrapFiles(rootDir, fileNames);
      logApplicationEntries(rootDir, partition.applicationEntries);
      if (partition.bootstrap.length > 0) {
        skipped.push(...partition.bootstrap);
        log.info(
          `Skipping ${partition.bootstrap.length} build system file(s) ` +
            `(${sampleIgnoredPaths(rootDir, partition.bootstrap.map(({ file }) => file))}). ` +
            `They boot the build under plain Node and stay JavaScript; pass --no-bootstrap ` +
            `to migrate them.`,
        );
      }
      return partition.kept;
    },
    skippedFiles: () => skipped,
  };
}

interface FileFilter {
  filterMigrationFiles: (fileNames: string[]) => string[];
}

/** Chains optional migration file filters into the single hook migrate accepts. */
export function combineFileFilters(
  filters: Array<FileFilter | undefined>,
): ((fileNames: string[]) => string[]) | undefined {
  const active = filters.filter((filter): filter is FileFilter => filter !== undefined);
  if (active.length === 0) return undefined;
  return (fileNames) =>
    active.reduce((names, filter) => filter.filterMigrationFiles(names), fileNames);
}
