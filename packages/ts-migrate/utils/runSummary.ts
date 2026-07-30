import fs from 'fs';
import path from 'path';
import log from 'updatable-log';

import { GeneratedFileParseError } from '@obiemunoz/ts-migrate-plugins';
import { errorMessage, MigrateResult } from '@obiemunoz/ts-migrate-server';
import { BootstrapFile } from './bootstrapFiles';
import { PackageJsonNotice, PackageJsonRewrite } from './packageJsonReferences';
import packageVersion from './packageVersion';
import { FileDebt, scanTypeDebtForFiles } from './typeDebt';

/**
 * The file --jsonSummary writes. All paths are rootDir-relative with forward
 * slashes; lists are sorted so identical runs produce identical files.
 */
interface RunSummaryBase {
  command: 'rename' | 'migrate' | 'reignore' | 'retype' | 'full';
  tsMigrateVersion: string;
  rootDir: string;
  exitCode: number;
  /** True when the run was a --dryRun: the summary describes what a real run would change. */
  dryRun: boolean;
}

export interface RenameRunSummary extends RunSummaryBase {
  command: 'rename';
  renamedFiles: Array<{ from: string; to: string }>;
  /** Files left untouched because git ignores them (0 with --gitignore=false). */
  skippedGitignoredFiles: number;
  /** Build system files kept as JavaScript, with the detection evidence (empty with --bootstrap=false). */
  skippedBootstrapFiles: Array<{ file: string; reason: string }>;
  /** package.json script paths and test globs repointed at the renamed files. */
  packageJsonRewrites: PackageJsonRewrite[];
  /** package.json entry points that name a renamed file and were left for a build step. */
  packageJsonNotices: PackageJsonNotice[];
}

export interface MigrateRunSummary extends RunSummaryBase {
  command: 'migrate' | 'reignore' | 'retype';
  /**
   * How many files the plugins were handed. 0 means the run touched nothing,
   * whatever else the summary says.
   */
  filesToMigrate: number;
  changedFiles: string[];
  /** Declaration files the run generated (e.g. the untyped module declarations). */
  generatedFiles: string[];
  /**
   * The generated declarations the project's ESLint reports a parse error on,
   * with its own message. A lint config that reads these files as JavaScript
   * rejects them, which leaves `eslint .` failing on a run that otherwise
   * succeeded, and no comment in the generated file can suppress it. Empty
   * where no lint pass resolved an engine to ask.
   */
  generatedFileParseErrors: Array<{ file: string; message: string }>;
  /**
   * Migrated files that still do not parse. These fail the run, unlike
   * nonMigratedFilesWithSyntaxErrors below.
   */
  migratedFilesWithSyntaxErrors: string[];
  /** Files outside the migration set that do not parse. These do not fail the run. */
  nonMigratedFilesWithSyntaxErrors: string[];
  plugins: Array<{ name: string; changedFileCount: number }>;
  /**
   * Files a plugin could not process, grouped by cause. A lint config that
   * throws leaves files unchanged without failing the run, so an unattended
   * run needs this to know it happened.
   */
  pluginFailures: Array<{
    plugin: string;
    reason: string;
    ruleId?: string;
    fileCount: number;
    files: string[];
  }>;
  /**
   * Work a plugin recognized and left for a person, grouped by cause. Marked
   * causes have a comment at every site, so this duplicates what the files
   * already say; it is here because nobody reads a CI log.
   */
  pluginNotices: Array<{
    plugin: string;
    reason: string;
    hint?: string;
    ruleId?: string;
    marked: boolean;
    fileCount: number;
    files: string[];
  }>;
  /**
   * Exceptions thrown out of a plugin, one entry per file. These fail the run,
   * unlike pluginFailures above. The message is bounded; the run log has the
   * full error.
   */
  pluginErrors: Array<{ plugin: string; file: string; message: string }>;
  /** Debt now present in the changed files; null if the post-run scan failed. */
  changedFilesTypeDebt: { aliasNames: string[]; totals: FileDebt } | null;
  /** Files left untouched because git ignores them (0 with --gitignore=false). */
  skippedGitignoredFiles: number;
  /** Build system files kept as JavaScript, with the detection evidence (empty with --bootstrap=false). */
  skippedBootstrapFiles: Array<{ file: string; reason: string }>;
}

export interface FullRunStep {
  name: 'init' | 'rename' | 'migrate' | 'check';
  /**
   * `skipped` is a step the run decided it did not need (a tsconfig that
   * already exists, a dry run that cannot reach the migration);
   * `not-reached` is one an earlier failure stopped it from starting.
   */
  status: 'ok' | 'failed' | 'skipped' | 'not-reached';
  /** The step's own exit code, or null where it never ran. */
  exitCode: number | null;
  /** The commit this step's writes went into, or null under --commit=false. */
  commit: string | null;
}

/**
 * The whole pipeline as one run. The per-step summaries are the ones the
 * individual commands write, nested rather than restated, so a caller reads
 * `rename` and `migrate` here exactly as it would read their own --jsonSummary
 * files. The shell script this replaces could only overwrite one with the other.
 */
export interface FullRunSummary extends RunSummaryBase {
  command: 'full';
  steps: FullRunStep[];
  /** The mechanical rewrite commits this run created, in the order it made them. */
  commits: Array<{ sha: string; subject: string }>;
  rename: RenameRunSummary | null;
  migrate: MigrateRunSummary | null;
}

export type RunSummary = RenameRunSummary | MigrateRunSummary | FullRunSummary;

function relativeTo(rootDir: string, fileName: string): string {
  return path.relative(rootDir, fileName).split(path.sep).join('/');
}

function summarizeBootstrapFiles(
  rootDir: string,
  skipped: BootstrapFile[] = [],
): Array<{ file: string; reason: string }> {
  return skipped
    .map(({ file, reason }) => ({ file: relativeTo(rootDir, file), reason }))
    .sort((a, b) => (a.file < b.file ? -1 : 1));
}

export function buildRenameRunSummary(params: {
  rootDir: string;
  exitCode: number;
  dryRun?: boolean;
  renamedFiles: Array<{ oldFile: string; newFile: string }>;
  skippedGitignoredFiles?: number;
  skippedBootstrapFiles?: BootstrapFile[];
  packageJsonRewrites?: PackageJsonRewrite[];
  packageJsonNotices?: PackageJsonNotice[];
}): RenameRunSummary {
  const { rootDir, exitCode, renamedFiles } = params;
  return {
    command: 'rename',
    tsMigrateVersion: packageVersion(),
    rootDir,
    exitCode,
    dryRun: params.dryRun ?? false,
    renamedFiles: renamedFiles
      .map(({ oldFile, newFile }) => ({
        from: relativeTo(rootDir, oldFile),
        to: relativeTo(rootDir, newFile),
      }))
      .sort((a, b) => (a.from < b.from ? -1 : 1)),
    skippedGitignoredFiles: params.skippedGitignoredFiles ?? 0,
    skippedBootstrapFiles: summarizeBootstrapFiles(rootDir, params.skippedBootstrapFiles),
    packageJsonRewrites: sortByFileAndKey(params.packageJsonRewrites ?? []),
    packageJsonNotices: sortByFileAndKey(params.packageJsonNotices ?? []),
  };
}

function sortByFileAndKey<T extends { file: string; key: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.file + a.key < b.file + b.key ? -1 : 1));
}

export function buildMigrateRunSummary(params: {
  command: 'migrate' | 'reignore' | 'retype';
  rootDir: string;
  exitCode: number;
  dryRun?: boolean;
  filesToMigrate: number;
  updatedSourceFiles: ReadonlySet<string>;
  /** In-memory contents to scan instead of the disk state; required for a dry run. */
  fileContents?: ReadonlyMap<string, string>;
  migratedFilesWithSyntaxErrors?: string[];
  nonMigratedFilesWithSyntaxErrors: string[];
  pluginStats: MigrateResult['pluginStats'];
  pluginFailures?: MigrateResult['pluginFailures'];
  pluginNotices?: MigrateResult['pluginNotices'];
  pluginErrors?: MigrateResult['pluginErrors'];
  generatedFiles?: ReadonlyMap<string, string>;
  generatedFileParseErrors?: readonly GeneratedFileParseError[];
  skippedGitignoredFiles?: number;
  skippedBootstrapFiles?: BootstrapFile[];
}): MigrateRunSummary {
  const { command, rootDir, exitCode, updatedSourceFiles, pluginStats } = params;

  // A summary of a successful run must still be written if this scan throws.
  let changedFilesTypeDebt: MigrateRunSummary['changedFilesTypeDebt'] = null;
  try {
    const debt = scanTypeDebtForFiles(rootDir, [...updatedSourceFiles], params.fileContents);
    changedFilesTypeDebt = { aliasNames: debt.aliasNames, totals: debt.totals };
  } catch (err) {
    log.warn(`Skipped the type debt scan of the changed files: ${errorMessage(err)}`);
  }

  return {
    command,
    tsMigrateVersion: packageVersion(),
    rootDir,
    exitCode,
    dryRun: params.dryRun ?? false,
    filesToMigrate: params.filesToMigrate,
    changedFiles: [...updatedSourceFiles].map((fileName) => relativeTo(rootDir, fileName)).sort(),
    generatedFiles: [...(params.generatedFiles?.keys() ?? [])]
      .map((fileName) => relativeTo(rootDir, fileName))
      .sort(),
    generatedFileParseErrors: (params.generatedFileParseErrors ?? [])
      .map(({ filePath, message }) => ({ file: relativeTo(rootDir, filePath), message }))
      .sort((a, b) => (a.file < b.file ? -1 : 1)),
    migratedFilesWithSyntaxErrors: (params.migratedFilesWithSyntaxErrors ?? [])
      .map((fileName) => relativeTo(rootDir, fileName))
      .sort(),
    nonMigratedFilesWithSyntaxErrors: params.nonMigratedFilesWithSyntaxErrors
      .map((fileName) => relativeTo(rootDir, fileName))
      .sort(),
    plugins: pluginStats.map(({ pluginName, changedFileCount }) => ({
      name: pluginName,
      changedFileCount,
    })),
    pluginFailures: (params.pluginFailures ?? []).map(
      ({ pluginName, reason, ruleId, fileCount, files }) => ({
        plugin: pluginName,
        reason,
        ruleId,
        fileCount,
        files: [...files].sort(),
      }),
    ),
    pluginNotices: (params.pluginNotices ?? [])
      .map(({ pluginName, reason, hint, ruleId, marked, fileCount, files }) => ({
        plugin: pluginName,
        reason,
        hint,
        ruleId,
        marked,
        fileCount,
        files: [...files].sort(),
      }))
      .sort((a, b) => (a.plugin + a.reason < b.plugin + b.reason ? -1 : 1)),
    pluginErrors: (params.pluginErrors ?? [])
      .map(({ pluginName, file, message }) => ({ plugin: pluginName, file, message }))
      .sort((a, b) => (a.file + a.plugin < b.file + b.plugin ? -1 : 1)),
    changedFilesTypeDebt,
    skippedGitignoredFiles: params.skippedGitignoredFiles ?? 0,
    skippedBootstrapFiles: summarizeBootstrapFiles(rootDir, params.skippedBootstrapFiles),
  };
}

/**
 * Writes the summary and returns the exit code the process should use: the
 * summary's own exitCode, forced nonzero when the file cannot be written. A
 * caller that asked for the summary must not see success without the file.
 */
export function writeRunSummary(filePath: string, summary: RunSummary): number {
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`);
    return summary.exitCode;
  } catch (err) {
    log.error(`Failed to write the --jsonSummary file ${filePath}: ${errorMessage(err)}`);
    return summary.exitCode || 1;
  }
}
