import path from 'path';
import ts from 'typescript';

const canonical = (fileName: string): string =>
  ts.sys.useCaseSensitiveFileNames ? path.resolve(fileName) : path.resolve(fileName).toLowerCase();

/**
 * Whether the project's tsconfig picks up a file that exists on disk. A
 * declaration file ts-migrate generates joins the migration's own program
 * either way; this is what decides whether later `tsc` runs see it too.
 *
 * Answers true when there is no readable tsconfig: with nothing to check
 * against, a warning would be noise.
 */
export default function isIncludedByTsConfig(rootDir: string, filePath: string): boolean {
  const configFile = path.join(rootDir, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error || !config) return true;
  const target = canonical(filePath);
  return ts
    .parseJsonConfigFileContent(config, ts.sys, rootDir)
    .fileNames.some((fileName) => canonical(fileName) === target);
}
