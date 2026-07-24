/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define */
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import {
  BootstrapFile,
  logApplicationEntries,
  logSharedBootstrapImports,
  partitionBootstrapFiles,
} from '../utils/bootstrapFiles';
import { logUnfilteredReason, partitionGitignored, sampleIgnoredPaths } from '../utils/gitignore';
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

export interface RenameResult {
  renamedFiles: Array<{ oldFile: string; newFile: string }>;
  skippedGitignoredFiles: number;
  skippedBootstrapFiles: BootstrapFile[];
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
          `Pass --no-gitignore to rename them.`,
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
      const lines = partition.bootstrap.map(
        ({ file, reason }) =>
          `  ${path.relative(rootDir, file).split(path.sep).join('/')} (${reason})`,
      );
      log.info(
        `Keeping ${partition.bootstrap.length} build system file(s) as JavaScript so the ` +
          `build still boots under plain Node:\n${lines.join('\n')}\n` +
          `Pass --no-bootstrap to rename them too, or add a file to the tsconfig "exclude" ` +
          `to keep it out of every run.`,
      );
      jsFiles = partition.kept;
    }
    logSharedBootstrapImports(rootDir, partition.shared);
  }

  if (jsFiles.length === 0) {
    log.info('No JS/JSX files to rename.');
    return { renamedFiles: [], skippedGitignoredFiles, skippedBootstrapFiles };
  }

  const toRename = jsFiles
    .map((oldFile) => {
      let newFile: string | undefined;
      if (oldFile.endsWith('.jsx')) {
        newFile = oldFile.replace(/\.jsx$/, '.tsx');
      } else if (oldFile.endsWith('.js') && jsFileContainsJsx(oldFile)) {
        newFile = oldFile.replace(/\.js$/, '.tsx');
      } else if (oldFile.endsWith('.js')) {
        newFile = oldFile.replace(/\.js$/, '.ts');
      }

      return { oldFile, newFile };
    })
    .filter((result): result is { oldFile: string; newFile: string } => !!result.newFile);

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
    updateProjectJson(rootDir, dryRun);
    return { renamedFiles: toRename, skippedGitignoredFiles, skippedBootstrapFiles };
  }

  log.info(`Renaming ${toRename.length} JS/JSX files in ${rootDir}...`);

  toRename.forEach(({ oldFile, newFile }) => {
    fs.renameSync(oldFile, newFile);
  });

  updateProjectJson(rootDir);

  log.info('Done.');
  return { renamedFiles: toRename, skippedGitignoredFiles, skippedBootstrapFiles };
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

  const { fileNames, errors } = ts.parseJsonConfigFileContent(
    {
      ...config,
      compilerOptions: {
        ...config.compilerOptions,
        // Force JS/JSX files to be included
        allowJs: true,
      },
      include,
    },
    ts.sys,
    rootDir,
  );

  if (errors.length > 0) {
    const errorMessage = ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => ts.sys.newLine,
    });
    throw new Error(
      `Errors parsing TypeScript config file content: ${configFile}\n${errorMessage}`,
    );
  }

  return fileNames.filter((fileName) => /\.jsx?$/.test(fileName));
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
    if ((isAllowedImport || isLayout) && /\.jsx?$/.test(value)) {
      return value.replace(/\.js(x?)$/, '.ts$1');
    }
    return undefined;
  });

  if (dryRun) {
    if (updatedText !== projectJsonText) {
      log.info(`Dry run: would update allowedImports in ${projectJsonFile}`);
    }
    return;
  }

  fs.writeFileSync(projectJsonFile, updatedText, 'utf-8');
  log.info(`Updated allowedImports in ${projectJsonFile}`);
}
