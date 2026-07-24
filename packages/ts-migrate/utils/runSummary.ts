import fs from 'fs';
import path from 'path';
import log from 'updatable-log';

import { MigrateResult } from '@obiemunoz/ts-migrate-server';
import { BootstrapFile } from './bootstrapFiles';
import packageVersion from './packageVersion';
import { FileDebt, scanTypeDebtForFiles } from './typeDebt';

/**
 * The file --jsonSummary writes. All paths are rootDir-relative with forward
 * slashes; lists are sorted so identical runs produce identical files.
 */
interface RunSummaryBase {
  command: 'rename' | 'migrate' | 'reignore';
  tsMigrateVersion: string;
  rootDir: string;
  exitCode: number;
  /** True when the run was a --dry-run: the summary describes what a real run would change. */
  dryRun: boolean;
}

export interface RenameRunSummary extends RunSummaryBase {
  command: 'rename';
  renamedFiles: Array<{ from: string; to: string }>;
  /** Files left untouched because git ignores them (0 with --no-gitignore). */
  skippedGitignoredFiles: number;
  /** Build system files kept as JavaScript, with the detection evidence (empty with --no-bootstrap). */
  skippedBootstrapFiles: Array<{ file: string; reason: string }>;
  /** .mjs/.cjs files kept at their extension, with the reason (never emptied by a flag). */
  skippedModuleFiles: Array<{ file: string; reason: string }>;
}

export interface MigrateRunSummary extends RunSummaryBase {
  command: 'migrate' | 'reignore';
  changedFiles: string[];
  nonMigratedFilesWithSyntaxErrors: string[];
  plugins: Array<{ name: string; changedFileCount: number }>;
  /** Debt now present in the changed files; null if the post-run scan failed. */
  changedFilesTypeDebt: { aliasNames: string[]; totals: FileDebt } | null;
  /** Files left untouched because git ignores them (0 with --no-gitignore). */
  skippedGitignoredFiles: number;
  /** Build system files kept as JavaScript, with the detection evidence (empty with --no-bootstrap). */
  skippedBootstrapFiles: Array<{ file: string; reason: string }>;
}

export type RunSummary = RenameRunSummary | MigrateRunSummary;

function relativeTo(rootDir: string, fileName: string): string {
  return path.relative(rootDir, fileName).split(path.sep).join('/');
}

function summarizeSkippedFiles(
  rootDir: string,
  skipped: Array<{ file: string; reason: string }> = [],
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
  skippedModuleFiles?: Array<{ file: string; reason: string }>;
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
    skippedBootstrapFiles: summarizeSkippedFiles(rootDir, params.skippedBootstrapFiles),
    skippedModuleFiles: summarizeSkippedFiles(rootDir, params.skippedModuleFiles),
  };
}

export function buildMigrateRunSummary(params: {
  command: 'migrate' | 'reignore';
  rootDir: string;
  exitCode: number;
  dryRun?: boolean;
  updatedSourceFiles: ReadonlySet<string>;
  /** In-memory contents to scan instead of the disk state; required for a dry run. */
  fileContents?: ReadonlyMap<string, string>;
  nonMigratedFilesWithSyntaxErrors: string[];
  pluginStats: MigrateResult['pluginStats'];
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
    log.warn('Skipped the type debt scan of the changed files:', err);
  }

  return {
    command,
    tsMigrateVersion: packageVersion(),
    rootDir,
    exitCode,
    dryRun: params.dryRun ?? false,
    changedFiles: [...updatedSourceFiles].map((fileName) => relativeTo(rootDir, fileName)).sort(),
    nonMigratedFilesWithSyntaxErrors: params.nonMigratedFilesWithSyntaxErrors
      .map((fileName) => relativeTo(rootDir, fileName))
      .sort(),
    plugins: pluginStats.map(({ pluginName, changedFileCount }) => ({
      name: pluginName,
      changedFileCount,
    })),
    changedFilesTypeDebt,
    skippedGitignoredFiles: params.skippedGitignoredFiles ?? 0,
    skippedBootstrapFiles: summarizeSkippedFiles(rootDir, params.skippedBootstrapFiles),
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
    log.error(`Failed to write the --jsonSummary file ${filePath}:`, err);
    return summary.exitCode || 1;
  }
}
