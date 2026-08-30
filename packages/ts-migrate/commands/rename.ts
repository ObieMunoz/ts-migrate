import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import { errorMessage } from '@obiemunoz/ts-migrate-server';
import {
  BootstrapFile,
  isKnownConfigName,
  logApplicationEntries,
  logSharedBootstrapImports,
  partitionBootstrapFiles,
} from '../utils/bootstrapFiles';
import { logUnfilteredReason, partitionGitignored, sampleIgnoredPaths } from '../utils/gitignore';
import { JS_EXTENSION_REGEX } from '../utils/jsExtensions';
import {
  PackageJsonNotice,
  PackageJsonRewrite,
  logPackageJsonReferences,
  updatePackageJsonReferences,
} from '../utils/packageJsonReferences';
import { relativeTo } from '../utils/paths';
import { parseConfigFileNames } from '../utils/tsConfigIncludes';
import { replaceJSON5Strings } from '../utils/updateJSON5';

interface RenameParams {
  rootDir: string;
  sources?: string | string[];
  /** Skip gitignored files (default). */
  gitignore?: boolean;
  /** Skip build system files (default). */
  bootstrap?: boolean;
  /** Print the rename mapping without touching any file. */
  dryRun?: boolean;
}

export interface SkippedRename {
  file: string;
  /** Human-readable explanation of why the file kept its extension. */
  reason: string;
}

export interface RenameResult {
  renamedFiles: Array<{ oldFile: string; newFile: string }>;
  skippedGitignoredFiles: number;
  skippedBootstrapFiles: BootstrapFile[];
  skippedModuleFiles: SkippedRename[];
  /** package.json script paths and test globs repointed at the renamed files. */
  packageJsonRewrites: PackageJsonRewrite[];
  /** package.json entry points that name a renamed file and were left alone. */
  packageJsonNotices: PackageJsonNotice[];
}

export default function rename({
  rootDir,
  sources,
  gitignore = true,
  bootstrap = true,
  dryRun,
}: RenameParams): RenameResult | null {
  const configFile = path.resolve(rootDir, 'tsconfig.json');
  if (!fs.existsSync(configFile)) {
    log.error('Could not find tsconfig.json at', configFile);
    return null;
  }

  let jsFiles: string[];
  try {
    jsFiles = findJSFiles(rootDir, configFile, sources);
  } catch (err) {
    log.error(err);
    return null;
  }

  let skippedGitignoredFiles = 0;
  if (gitignore) {
    const partition = partitionGitignored(rootDir, jsFiles);
    logUnfilteredReason(rootDir, partition);
    if (partition.ignored.length > 0) {
      skippedGitignoredFiles = partition.ignored.length;
      log.info(
        `Skipping ${partition.ignored.length} gitignored JS/JSX file(s) ` +
          `(${sampleIgnoredPaths(rootDir, partition.ignored)}); they will not be renamed. ` +
          `Pass --gitignore=false to rename them.`,
      );
      jsFiles = partition.kept;
    }
  }

  let skippedBootstrapFiles: BootstrapFile[] = [];
  if (bootstrap) {
    const partition = partitionBootstrapFiles(rootDir, jsFiles, { detectSharedImporters: true });
    logApplicationEntries(rootDir, partition.applicationEntries);
    if (partition.bootstrap.length > 0) {
      skippedBootstrapFiles = partition.bootstrap;
      log.info(
        `Keeping ${partition.bootstrap.length} build system file(s) as JavaScript so the ` +
          `build still boots under plain Node:\n${reasonLines(rootDir, partition.bootstrap)}\n` +
          `Pass --bootstrap=false to rename them too, or add a file to the tsconfig "exclude" ` +
          `to keep it out of every run.`,
      );
      jsFiles = partition.kept;
    }
    logSharedBootstrapImports(rootDir, partition.shared);
  }

  if (jsFiles.length === 0) {
    log.info('No JS/JSX files to rename.');
    return {
      renamedFiles: [],
      skippedGitignoredFiles,
      skippedBootstrapFiles,
      skippedModuleFiles: [],
      packageJsonRewrites: [],
      packageJsonNotices: [],
    };
  }

  const skippedModuleFiles: SkippedRename[] = [];
  const toRename = jsFiles
    .map((oldFile) => {
      let newFile: string | undefined;
      if (oldFile.endsWith('.jsx')) {
        newFile = oldFile.replace(/\.jsx$/, '.tsx');
      } else if (oldFile.endsWith('.js') && jsFileContainsJsx(oldFile)) {
        newFile = oldFile.replace(/\.js$/, '.tsx');
      } else if (oldFile.endsWith('.js')) {
        newFile = oldFile.replace(/\.js$/, '.ts');
      } else if (path.extname(oldFile) in moduleExtensions) {
        const target = moduleRenameTarget(oldFile);
        if ('newFile' in target) {
          newFile = target.newFile;
        } else {
          skippedModuleFiles.push({ file: oldFile, reason: target.reason });
        }
      }

      return { oldFile, newFile };
    })
    .filter((result): result is { oldFile: string; newFile: string } => !!result.newFile);

  if (skippedModuleFiles.length > 0) {
    log.info(
      `Keeping ${skippedModuleFiles.length} .mjs/.cjs file(s) at their current extension:\n` +
        `${reasonLines(rootDir, skippedModuleFiles)}`,
    );
  }

  if (dryRun) {
    const mapping = toRename
      .map(
        ({ oldFile, newFile }) =>
          `  ${path.relative(rootDir, oldFile)} -> ${path.relative(rootDir, newFile)}`,
      )
      .join('\n');
    log.info(
      `Dry run: ${toRename.length} JS/JSX file(s) would be renamed in ${rootDir} ` +
        `(nothing was written):\n${mapping}`,
    );
  } else {
    log.info(`Renaming ${toRename.length} JS/JSX files in ${rootDir}...`);
    if (renameFiles(rootDir, toRename) === null) return null;
  }

  updateProjectJson(rootDir, dryRun);
  // The mapping is final here: the gitignore, bootstrap, and .mjs/.cjs
  // partitions have all run, so a file that kept its .js extension is absent
  // from it and every reference to it is left alone.
  const references = updatePackageJsonReferences(rootDir, toRename, { dryRun });
  logPackageJsonReferences(rootDir, references, dryRun);

  if (!dryRun) log.info('Done.');
  return {
    renamedFiles: toRename,
    skippedGitignoredFiles,
    skippedBootstrapFiles,
    skippedModuleFiles,
    packageJsonRewrites: references.rewrites,
    packageJsonNotices: references.notices,
  };
}

/**
 * The skipped files as one indented, rootDir-relative line each, joined for a
 * log message.
 */
function reasonLines(
  rootDir: string,
  skipped: ReadonlyArray<{ file: string; reason: string }>,
): string {
  return skipped.map(({ file, reason }) => `  ${relativeTo(rootDir, file)} (${reason})`).join('\n');
}

/**
 * Moves the files, reporting a failure rather than letting one reach the
 * process: a checkout the run cannot write to is the environment, not a bug in
 * ts-migrate, and the crash handler would say otherwise over a stack trace.
 *
 * The moves before the failing one stand. Nothing that reads the mapping has
 * run yet, so the tree is only part renamed, and re-running once the write
 * succeeds finishes it: the files already moved no longer have a JS extension
 * and drop out of the mapping.
 */
function renameFiles(
  rootDir: string,
  toRename: ReadonlyArray<{ oldFile: string; newFile: string }>,
): true | null {
  for (let i = 0; i < toRename.length; i += 1) {
    const { oldFile, newFile } = toRename[i];
    try {
      fs.renameSync(oldFile, newFile);
    } catch (err) {
      log.error(
        `Could not rename ${path.relative(rootDir, oldFile)} to ` +
          `${path.relative(rootDir, newFile)}: ${errorMessage(err)}.\n` +
          `${i} of ${toRename.length} file(s) were renamed before this and are still renamed; ` +
          `no package.json or project.json reference was updated. Re-run \`ts-migrate rename\` ` +
          `once the files can be written and it will pick up where this stopped.`,
      );
      return null;
    }
  }
  return true;
}

function findJSFiles(rootDir: string, configFile: string, sources?: string | string[]) {
  const configFileContents = ts.sys.readFile(configFile);
  if (configFileContents == null) {
    throw new Error(`Failed to read TypeScript config file: ${configFile}`);
  }

  const { config, error } = ts.parseConfigFileTextToJson(configFile, configFileContents);
  if (error) {
    const errorMessage = ts.flattenDiagnosticMessageText(error.messageText, ts.sys.newLine);
    throw new Error(
      `Error parsing TypeScript config file text to json: ${configFile}\n${errorMessage}`,
    );
  }

  let { include } = config;

  // Sources come from either `config.files` or `config.includes`.
  // If the --sources flag is set, let's ignore both of those config properties
  // and set our own `config.includes` instead.
  if (sources !== undefined) {
    include = Array.isArray(sources) ? sources : [sources];
    delete config.files;
  }

  const fileNames = parseConfigFileNames(
    {
      ...config,
      compilerOptions: {
        ...config.compilerOptions,
        // Force JS/JSX files to be included
        allowJs: true,
      },
      include,
    },
    rootDir,
    configFile,
  );

  return fileNames.filter((fileName) => JS_EXTENSION_REGEX.test(fileName));
}

const moduleExtensions: Record<string, string> = { '.mjs': '.mts', '.cjs': '.cts' };

/**
 * The TypeScript extension a .mjs/.cjs file renames to, or the reason it keeps
 * the one it has: build tools load config files by their exact name, and
 * neither .mts nor .cts is a JSX-enabled extension.
 */
function moduleRenameTarget(oldFile: string): { newFile: string } | { reason: string } {
  const oldExtension = path.extname(oldFile);
  const newExtension = moduleExtensions[oldExtension];
  if (isKnownConfigName(oldFile)) {
    return { reason: `config file loaded by name, which ${newExtension} would break` };
  }
  if (jsFileContainsJsx(oldFile)) {
    return { reason: `contains JSX, which ${newExtension} cannot hold` };
  }
  return { newFile: oldFile.slice(0, -oldExtension.length) + newExtension };
}

/**
 * Heuristic to determine whether a .js file contains JSX.
 */
function jsFileContainsJsx(jsFileName: string): boolean {
  const contents = fs.readFileSync(jsFileName, 'utf8');
  return (
    /(from ['"]react['"]|require\(['"]react['"]\)|@jsx)/.test(contents) &&
    /<[A-Za-z>]/.test(contents)
  );
}

function updateProjectJson(rootDir: string, dryRun?: boolean) {
  const projectJsonFile = path.resolve(rootDir, 'project.json');
  if (!fs.existsSync(projectJsonFile)) {
    return;
  }

  const projectJsonText = fs.readFileSync(projectJsonFile, 'utf-8');
  const updatedText = replaceJSON5Strings(projectJsonText, (keyPath, value) => {
    const isAllowedImport =
      keyPath.length === 2 && keyPath[0] === 'allowedImports' && typeof keyPath[1] === 'number';
    const isLayout = keyPath.length === 1 && keyPath[0] === 'layout';
    if ((isAllowedImport || isLayout) && JS_EXTENSION_REGEX.test(value)) {
      return value.replace(/\.([cm]?)js(x?)$/, '.$1ts$2');
    }
    return undefined;
  });

  if (dryRun) {
    if (updatedText !== projectJsonText) {
      log.info(`Dry run: would update allowedImports in ${projectJsonFile}`);
    }
    return;
  }

  // The files have already moved by the time this runs, so a write that fails
  // leaves a stale reference to fix by hand rather than a failed rename.
  try {
    fs.writeFileSync(projectJsonFile, updatedText, 'utf-8');
  } catch (err) {
    log.warn(
      `Could not update allowedImports in ${projectJsonFile}: ${errorMessage(err)}. ` +
        'The entries still name the old JS paths.',
    );
    return;
  }
  log.info(`Updated allowedImports in ${projectJsonFile}`);
}
