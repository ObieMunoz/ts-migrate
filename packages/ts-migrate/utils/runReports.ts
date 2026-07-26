import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import log from 'updatable-log';

import {
  formatGlobalDeclarationsReport,
  formatSuppressionReport,
  formatSuppressionSummary,
  formatTypesPackagePreflight,
  formatTypesPackageReport,
  GlobalDeclarationsCollector,
  preflightTypesPackages,
  SuppressionExplainer,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { errorMessage, MigrateResult } from '@obiemunoz/ts-migrate-server';
import formatFollowUpReport from './followUpReport';
import { describeTypeScript, TypeScriptDecision, typeScriptWarning } from './resolveTypeScript';
import { ensureIncludedByTsConfig } from './tsConfigIncludes';
import {
  FileDebt,
  formatFileDebtCounts,
  formatTypeDebtSummary,
  scanTypeDebt,
  scanTypeDebtForFiles,
} from './typeDebt';

/**
 * What `migrate`, `reignore` and the `full` pipeline print around a run. Kept
 * out of cli.ts so a command that composes several runs reports them the same
 * way the single-run commands do, rather than restating any of it.
 *
 * The compiler decision is passed in rather than read from
 * `utils/useProjectTypeScript`: that module redirects every
 * `require('typescript')` in the process the moment it loads, which a module
 * imported for its formatting has no business doing.
 */

/**
 * Printed twice: with the banner, and again on the last screen. The banner is
 * in the first three lines of a run that can take many minutes, so by the time
 * the suppressions this qualifies exist it has long scrolled away.
 */
export function logTypeScriptWarning(decision: TypeScriptDecision): void {
  const warning = typeScriptWarning(decision);
  if (warning) log.warn(warning);
}

/**
 * The config file the flags came from, when there was one. A file found by
 * searching upward is otherwise invisible, and it decides what the run does.
 */
export function logConfigFile(configPath?: string): void {
  if (configPath) log.info(`Flags from ${configPath}`);
}

/**
 * Which compiler this run reasoned with, reported from the loaded instance so
 * the banner is what happened rather than what was asked for.
 */
export function logTypeScriptDecision(decision: TypeScriptDecision): void {
  log.info(describeTypeScript(decision, ts.version));
  if (ts.version !== decision.version) {
    log.warn(
      `Loaded TypeScript ${ts.version}, not the ${decision.version} at ` +
        `${decision.packageDir}: something else in this process resolves the compiler first.`,
    );
  }
  logTypeScriptWarning(decision);
}

/**
 * Whether the project's tsconfig pins a `types` array, which decides whether a
 * newly installed @types package also needs an entry there to be loaded. Parsed
 * with a host that enumerates nothing: only the compiler options are read.
 */
function tsConfigPinsTypes(rootDir: string): boolean {
  const { config, error } = ts.readConfigFile(path.join(rootDir, 'tsconfig.json'), ts.sys.readFile);
  if (error || !config) return false;
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: () => [],
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };
  return ts.parseJsonConfigFileContent(config, host, rootDir).options.types !== undefined;
}

/**
 * What package.json and the install layout alone say about missing type
 * packages, printed with the banner so it is read before the pipeline turns the
 * errors those packages would resolve into suppressions. It claims no counts,
 * so it cannot contradict the end of run report. Advice, and so it must never
 * fail an otherwise successful run.
 */
export function printTypesPackagePreflight(rootDir: string): void {
  try {
    const preflightText = formatTypesPackagePreflight(
      preflightTypesPackages(rootDir),
      tsConfigPinsTypes(rootDir),
    );
    if (preflightText) log.warn(preflightText);
  } catch (err) {
    log.warn('Skipped the type package preflight:', err);
  }
}

/**
 * The type definition recommendations, as text so the caller can decide where
 * they go: the log, a `--typesReportFile`, or the end of a `full` run, where
 * they will not scroll out of view. A recommendation report must never fail an
 * otherwise successful run, so a failure here is a warning and no report.
 */
export function typesPackageReport(
  detector: TypesPackageDetector,
  rootDir: string,
  folder: string,
): string | undefined {
  try {
    return formatTypesPackageReport(detector.summarize(rootDir), folder) || undefined;
  } catch (err) {
    log.warn(`Skipped type definition recommendations: ${errorMessage(err)}`);
    return undefined;
  }
}

/**
 * The evidence the compiler had for every diagnostic ts-ignore suppressed. Only
 * the grouped counts reach the log; the per-site detail goes to reportFile,
 * since stdout is the progress log. Must never fail an otherwise successful run.
 */
export function printSuppressionReport(
  explainer: SuppressionExplainer,
  rootDir: string,
  reportFile?: string,
): void {
  try {
    const report = explainer.summarize(rootDir);
    if (reportFile) {
      fs.writeFileSync(reportFile, `${formatSuppressionReport(report)}\n`);
    }
    const summary = formatSuppressionSummary(report, reportFile);
    if (summary) log.info(summary);
  } catch (err) {
    log.warn(`Skipped the suppression report: ${errorMessage(err)}`);
  }
}

/**
 * What the run declared on `window` and `globalThis`, and what it found but
 * could not declare. Printed rather than written to a file: it is one line per
 * global, and each one names an edit worth making now. Must never fail an
 * otherwise successful run.
 */
export function printGlobalDeclarationsReport(
  globalDeclarations: GlobalDeclarationsCollector,
): void {
  try {
    const reportText = formatGlobalDeclarationsReport(globalDeclarations.summarize());
    if (reportText) log.info(reportText);
  } catch (err) {
    log.warn(`Skipped the global declarations report: ${errorMessage(err)}`);
  }
}

/**
 * Names the declaration files the run generated and keeps them in the project's
 * file set. A generated file the tsconfig does not match is in effect for the
 * migration and nothing after it, so the errors it resolved come back on the
 * next `tsc` run — starting with the one the `full` pipeline runs to close out.
 */
export function printGeneratedFiles(
  rootDir: string,
  generatedFiles: ReadonlyMap<string, string>,
  dryRun: boolean,
): void {
  generatedFiles.forEach((_text, filePath) => {
    const displayPath = path.relative(rootDir, filePath) || filePath;
    log.info(
      dryRun
        ? `Dry run: would write the generated declarations to ${displayPath}.`
        : `Wrote the generated declarations to ${displayPath}.`,
    );
    reportGeneratedFileInclusion(rootDir, filePath, displayPath, dryRun);
  });
}

export function reportGeneratedFileInclusion(
  rootDir: string,
  filePath: string,
  displayPath: string,
  dryRun: boolean,
): void {
  let repair;
  try {
    repair = ensureIncludedByTsConfig(rootDir, filePath, { dryRun });
  } catch (err) {
    log.warn(
      'Skipped checking whether tsconfig.json includes the generated declarations: ' +
        errorMessage(err),
    );
    return;
  }

  switch (repair.kind) {
    case 'included':
      break;
    case 'added':
      log.info(
        `tsconfig.json did not match ${displayPath}, so "${repair.entry}" was added to its ` +
          `"${repair.key}". Without it the declarations would have applied to this run only.`,
      );
      break;
    case 'would-add':
      log.info(
        `Dry run: tsconfig.json does not match ${displayPath}; a real run would add ` +
          `"${repair.entry}" to its "${repair.key}".`,
      );
      break;
    case 'failed':
      log.error(
        `tsconfig.json does not match ${displayPath} and ${repair.reason}, so the declarations ` +
          `applied to this run only: every error they resolved comes back on the next \`tsc\` ` +
          `run. Add "${repair.entry}" to "files" in ${repair.configFile} by hand.`,
      );
      break;
    default:
      break;
  }
}

/**
 * What the run left for a person to do. Printed at the end because that is the
 * only point the whole list is known and the only part of a long run's output
 * anyone reliably reads. Must never fail an otherwise successful run.
 */
export function printFollowUpReport(pluginNotices: MigrateResult['pluginNotices']): void {
  try {
    const reportText = formatFollowUpReport(pluginNotices);
    if (reportText) log.warn(reportText);
  } catch (err) {
    log.warn(`Skipped the follow-up report: ${errorMessage(err)}`);
  }
}

/**
 * The last line of a failing run. Both causes were logged where they happened,
 * which on a large project is hours and thousands of lines above, and the
 * closing sequence is otherwise identical to a successful run's.
 */
export function logRunFailure(
  pluginErrors: MigrateResult['pluginErrors'],
  migratedFilesWithSyntaxErrors: string[],
): void {
  const causes = [];
  if (pluginErrors.length > 0) {
    causes.push(`${pluginErrors.length} file(s) errored in plugins`);
  }
  if (migratedFilesWithSyntaxErrors.length > 0) {
    causes.push(`${migratedFilesWithSyntaxErrors.length} file(s) still have syntax errors`);
  }
  log.error(
    causes.length > 0
      ? `Migration failed: ${causes.join(', ')}. See the errors above.`
      : 'Migration failed. See the errors above.',
  );
}

/**
 * Names an empty migration set in terms of the signal that produced it, and
 * attaches the tsconfig's own diagnostics. Nothing here scans the disk to
 * narrow the cause further: a confident wrong guess costs more than a plain
 * count with the diagnostic attached.
 */
export function describeEmptyMigrationSet(
  { reason, diagnostics }: NonNullable<MigrateResult['emptyMigrationSet']>,
  folder: string,
): string {
  const lines = [`No files to migrate in ${folder}.`];
  switch (reason) {
    case 'tsconfig-matched-nothing':
      lines.push(
        `tsconfig.json matched no input files. If ${folder} is still JavaScript, run ` +
          `ts-migrate rename ${folder} first.`,
      );
      break;
    case 'only-javascript-files':
      lines.push(
        `Every file matched is JavaScript, which migrate never edits. Run ` +
          `ts-migrate rename ${folder} first.`,
      );
      break;
    case 'sources-matched-nothing':
      lines.push(`--sources matched no file under ${folder}.`);
      break;
    case 'only-declaration-files':
      lines.push('Only declaration files were matched, and they hold nothing to migrate.');
      break;
    case 'all-files-filtered':
      lines.push(
        'Every candidate file was skipped as gitignored or as a build system file. ' +
          'Pass --gitignore=false or --bootstrap=false to include them.',
      );
      break;
    default:
      lines.push('Nothing the program includes is a file this command can edit.');
  }
  return [...lines, ...diagnostics].join('\n');
}

/** The end-of-run debt summary must never fail an otherwise successful run. */
export function printTypeDebtSummary(rootDir: string, folder: string, gitignore?: boolean): void {
  try {
    log.info(formatTypeDebtSummary(scanTypeDebt(rootDir, gitignore), folder));
  } catch (err) {
    log.warn(`Skipped type debt summary: ${errorMessage(err)}`);
  }
}

/**
 * A dry run's replacement for the debt summary: every file a real run would
 * have updated, with the suppression and any counts it would then contain.
 * Reads the would-be contents, never the disk.
 */
export function printDryRunSummary(
  rootDir: string,
  folder: string,
  updatedSourceFiles: ReadonlySet<string>,
  fileContents: ReadonlyMap<string, string>,
): void {
  if (updatedSourceFiles.size === 0) {
    log.info(`Dry run: no files would be updated in ${folder}.`);
    return;
  }

  let debtByFile: Record<string, FileDebt> = {};
  try {
    debtByFile = scanTypeDebtForFiles(rootDir, [...updatedSourceFiles], fileContents).files;
  } catch (err) {
    log.warn(`Skipped the suppression counts of the dry run summary: ${errorMessage(err)}`);
  }

  const lines = [
    `Dry run: ${updatedSourceFiles.size} file(s) would be updated in ${folder} ` +
      `(nothing was written):`,
  ];
  [...updatedSourceFiles]
    .map((fileName) => path.relative(rootDir, fileName).split(path.sep).join('/'))
    .sort()
    .forEach((file) => {
      const debt = debtByFile[file];
      lines.push(debt ? `  ${file} (${formatFileDebtCounts(debt)})` : `  ${file}`);
    });
  lines.push('For full diffs, run without --dryRun on a clean git tree and use git diff.');
  log.info(lines.join('\n'));
}
