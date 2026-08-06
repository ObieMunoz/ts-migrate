import log from 'updatable-log';

import reignore from './reignore';
import { TypeScriptDecision } from '../utils/resolveTypeScript';
import { canKeepGeneratedDeclarations } from '../utils/tsConfigIncludes';
import {
  logRunFailure,
  logTypeScriptDecision,
  logTypeScriptWarning,
  printDryRunSummary,
  printFollowUpReport,
  printGeneratedFiles,
  printSuppressionReport,
  printTypeDebtChange,
  printTypeDebtSummary,
  printTypesPackagePreflight,
  reportGeneratedFileLinting,
  typeDebtBaseline,
  typesPackageReport,
} from '../utils/runReports';
import { buildMigrateRunSummary, writeRunSummary } from '../utils/runSummary';

/**
 * A reignore run and everything it reports, with the exit code returned rather
 * than handed to `process.exit`.
 *
 * `retype` runs the same pipeline with the annotation retry switched on, so both
 * commands report through here: a run that strips and re-adds has a dozen
 * reports to print, and two copies of that list would drift.
 */
export interface RunReignoreParams {
  /** Which of the two commands this is, for the --jsonSummary. */
  command: 'reignore' | 'retype';
  rootDir: string;
  /** The folder as the user wrote it. Reports name this, not the resolved path. */
  folder: string;
  /** The compiler this process was redirected at, for the opening banner. */
  typeScript: TypeScriptDecision;
  sources?: string | string[];
  ambientSources?: boolean;
  messagePrefix?: string;
  gitignore?: boolean;
  bootstrap?: boolean;
  projectEslint?: boolean;
  declareUntypedModules?: boolean;
  addMissingImports?: boolean;
  ambiguousImports?: 'first' | 'skip';
  annotations?: boolean;
  casts?: boolean;
  typesPreflight?: boolean;
  suppressionReportFile?: string;
  dryRun?: boolean;
  jsonSummary?: string;
  /** End with what the run took off the debt, rather than with the totals. */
  debtChange?: boolean;
}

export default async function runReignore(params: RunReignoreParams): Promise<number> {
  const { rootDir, folder, dryRun = false } = params;
  logTypeScriptDecision(params.typeScript);
  if (params.typesPreflight ?? true) printTypesPackagePreflight(rootDir);

  // Scanned before the pipeline runs, since it is the disk this reads and the
  // pipeline is about to rewrite it.
  const debtBefore =
    params.debtChange && !dryRun ? typeDebtBaseline(rootDir, params.gitignore) : undefined;

  const {
    exitCode,
    filesToMigrate,
    typesPackageDetector,
    suppressionExplainer,
    updatedSourceFiles,
    updatedFileTexts,
    migratedFilesWithSyntaxErrors,
    nonMigratedFilesWithSyntaxErrors,
    pluginStats,
    pluginFailures,
    pluginNotices,
    pluginErrors,
    generatedFiles,
    skippedGitignoredFiles,
    skippedBootstrapFiles,
  } = await reignore({
    rootDir,
    sources: params.sources,
    ambientSources: params.ambientSources,
    messagePrefix: params.messagePrefix,
    gitignore: params.gitignore,
    bootstrap: params.bootstrap,
    projectEslint: params.projectEslint,
    // See the migrate command: without a tsconfig to keep it in, a
    // generated declaration file is undone by the next `tsc` run.
    declareUntypedModules:
      (params.declareUntypedModules ?? true) && canKeepGeneratedDeclarations(rootDir),
    addMissingImports: params.addMissingImports,
    ambiguousImports: params.ambiguousImports,
    annotations: params.annotations,
    casts: params.casts,
    dryRun,
  });

  printGeneratedFiles(rootDir, generatedFiles, dryRun);
  const generatedFileParseErrors = await reportGeneratedFileLinting(
    rootDir,
    [...generatedFiles].map(([filePath, text]) => ({ filePath, text })),
    dryRun,
  );
  const typesReport = typesPackageReport(typesPackageDetector, rootDir, folder);
  if (typesReport) log.info(typesReport);
  printSuppressionReport(suppressionExplainer, rootDir, params.suppressionReportFile);
  if (dryRun) {
    printDryRunSummary(rootDir, folder, updatedSourceFiles, updatedFileTexts);
  } else if (params.debtChange) {
    printTypeDebtChange(rootDir, folder, debtBefore, params.gitignore);
  } else {
    printTypeDebtSummary(rootDir, folder, params.gitignore);
  }
  logTypeScriptWarning(params.typeScript);
  printFollowUpReport(pluginNotices);

  if (exitCode !== 0) {
    logRunFailure(pluginErrors, migratedFilesWithSyntaxErrors);
  }

  if (!params.jsonSummary) {
    return exitCode;
  }

  return writeRunSummary(
    params.jsonSummary,
    buildMigrateRunSummary({
      command: params.command,
      rootDir,
      exitCode,
      dryRun,
      filesToMigrate,
      updatedSourceFiles,
      fileContents: updatedFileTexts,
      migratedFilesWithSyntaxErrors,
      nonMigratedFilesWithSyntaxErrors,
      pluginStats,
      pluginFailures,
      pluginNotices,
      pluginErrors,
      generatedFiles,
      generatedFileParseErrors,
      skippedGitignoredFiles,
      skippedBootstrapFiles,
    }),
  );
}
