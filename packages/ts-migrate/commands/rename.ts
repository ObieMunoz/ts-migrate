/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define */
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import { replaceJSON5Strings } from '../utils/updateJSON5';

interface RenameParams {
  rootDir: string;
  sources?: string | string[];
}

export default function rename({
  rootDir,
  sources,
}: RenameParams): Array<{ oldFile: string; newFile: string }> | null {
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

  if (jsFiles.length === 0) {
    log.info('No JS/JSX files to rename.');
    return [];
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

  log.info(`Renaming ${toRename.length} JS/JSX files in ${rootDir}...`);

  toRename.forEach(({ oldFile, newFile }) => {
    fs.renameSync(oldFile, newFile);
  });

  updateProjectJson(rootDir);

  log.info('Done.');
  return toRename;
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

function updateProjectJson(rootDir: string) {
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

  fs.writeFileSync(projectJsonFile, updatedText, 'utf-8');
  log.info(`Updated allowedImports in ${projectJsonFile}`);
}
