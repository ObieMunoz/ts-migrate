import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { appendJSON5ArrayItem } from './updateJSON5';

const canonical = (fileName: string): string =>
  ts.sys.useCaseSensitiveFileNames ? path.resolve(fileName) : path.resolve(fileName).toLowerCase();

/** Whether a parsed tsconfig object resolves to a file set containing filePath. */
function matchesFile(config: unknown, rootDir: string, filePath: string): boolean {
  const target = canonical(filePath);
  return ts
    .parseJsonConfigFileContent(config, ts.sys, rootDir)
    .fileNames.some((fileName) => canonical(fileName) === target);
}

interface ReadConfig {
  configFile: string;
  text: string;
  config: any;
  /**
   * Whether the file lists an "include" of its own. Read here because
   * `parseJsonConfigFileContent` merges an extended base into the object it is
   * given, so afterwards an inherited include is indistinguishable from an own
   * one — and appending to an inherited one writes a local include that
   * replaces the base's list rather than adding to it.
   */
  hasOwnInclude: boolean;
}

/** The project's own tsconfig.json as both source text and parsed object. */
function readTsConfig(rootDir: string): ReadConfig | null {
  const configFile = path.join(rootDir, 'tsconfig.json');
  let text: string;
  try {
    text = fs.readFileSync(configFile, 'utf-8');
  } catch {
    return null;
  }
  const { config, error } = ts.parseConfigFileTextToJson(configFile, text);
  if (error || !config || typeof config !== 'object') return null;
  return { configFile, text, config, hasOwnInclude: Array.isArray(config.include) };
}

/**
 * Whether the project's tsconfig picks up a file that exists on disk. A
 * declaration file ts-migrate generates joins the migration's own program
 * either way; this is what decides whether later `tsc` runs see it too.
 *
 * Answers true when there is no readable tsconfig: with nothing to check
 * against, a warning would be noise.
 */
export default function isIncludedByTsConfig(rootDir: string, filePath: string): boolean {
  const read = readTsConfig(rootDir);
  if (!read) return true;
  return matchesFile(read.config, rootDir, filePath);
}

/**
 * Whether a generated declaration file can be kept in the project's file set.
 * False means a migration that generates one leaves a project whose next `tsc`
 * run reports every error the file resolved, so the caller declares nothing and
 * casts at each site instead.
 */
export function canKeepGeneratedDeclarations(rootDir: string): boolean {
  return readTsConfig(rootDir) !== null;
}

export type TsConfigListKey = 'include' | 'files';

export type TsConfigIncludeRepair =
  | { kind: 'included' }
  | { kind: 'added'; key: TsConfigListKey; entry: string; configFile: string }
  | { kind: 'would-add'; key: TsConfigListKey; entry: string; configFile: string }
  | { kind: 'failed'; entry: string; configFile: string; reason: string };

/**
 * Keeps a generated declaration file in the project's file set, editing
 * tsconfig.json when it does not already match it. Without the edit the file is
 * in effect for the migration's own program and nothing after it, so the errors
 * it resolved come back on the next `tsc` run, starting with the pipeline's own
 * check.
 *
 * "include" is the first choice: it is where a project lists its sources, and a
 * path in it that stops existing is ignored rather than an error. "files" is the
 * fallback, because it is unioned with an include inherited through "extends"
 * (which appending to would override) and because "exclude" does not filter it.
 * Each candidate is applied to a copy and re-resolved before it is written, so
 * an edit that does not actually change the file set is never left behind.
 */
export function ensureIncludedByTsConfig(
  rootDir: string,
  filePath: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): TsConfigIncludeRepair {
  const read = readTsConfig(rootDir);
  if (!read) return { kind: 'included' };
  const { configFile, text, config, hasOwnInclude } = read;
  if (matchesFile(config, rootDir, filePath)) return { kind: 'included' };

  const entry = `./${path.relative(rootDir, filePath).split(path.sep).join('/')}`;
  const keys: TsConfigListKey[] = hasOwnInclude ? ['include', 'files'] : ['files'];

  for (const key of keys) {
    let edited: string;
    try {
      edited = appendJSON5ArrayItem(text, [key], entry);
    } catch {
      continue;
    }
    // A dry run has not written the declaration file, and an "include" glob
    // only matches what is on disk, so the candidate cannot be re-resolved.
    if (dryRun) return { kind: 'would-add', key, entry, configFile };

    const parsed = ts.parseConfigFileTextToJson(configFile, edited);
    if (parsed.error || !parsed.config) continue;
    if (!matchesFile(parsed.config, rootDir, filePath)) continue;
    fs.writeFileSync(configFile, edited);
    return { kind: 'added', key, entry, configFile };
  }

  return {
    kind: 'failed',
    entry,
    configFile,
    reason: keys.includes('include')
      ? 'neither "include" nor "files" could be made to match it'
      : '"files" could not be made to match it',
  };
}
