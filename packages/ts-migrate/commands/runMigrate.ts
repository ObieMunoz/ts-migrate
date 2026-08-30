import fs from 'fs';
import path from 'path';
import log from 'updatable-log';

import {
  GlobalDeclarationsCollector,
  SuppressionExplainer,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { errorMessage, migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import buildMigrateConfig, { BuildMigrateConfigParams } from './migrate';
import ensureAliasDeclarations from '../utils/aliasDeclarations';
import { createMigrationFileFilters } from '../utils/bootstrapFiles';
import { TypeScriptDecision } from '../utils/resolveTypeScript';
import { canKeepGeneratedDeclarations } from '../utils/tsConfigIncludes';
import {
  describeEmptyMigrationSet,
  logRunFailure,
  logTypeScriptDecision,
  logTypeScriptWarning,
  printDryRunSummary,
  printFollowUpReport,
  printGeneratedFiles,
  printGlobalDeclarationsReport,
  printSuppressionReport,
  printTypeDebtSummary,
  printTypesPackagePreflight,
  reportGeneratedFileInclusion,
  reportGeneratedFileLinting,
  typesPackageReport,
} from '../utils/runReports';
import { buildMigrateRunSummary, MigrateRunSummary, writeRunSummary } from '../utils/runSummary';

/**
 * A migrate run and everything it reports, with the exit code returned rather
 * than handed to `process.exit`. The `full` pipeline runs the same migration as
 * one of its four steps and has three more to run afterwards, so the step
 * cannot end the process, and neither may it restate any of the reporting.
 */
export interface RunMigrateParams {
  rootDir: string;
  /** The folder as the user wrote it. Reports name this, not the resolved path. */
  folder: string;
  /** The compiler this process was redirected at, for the opening banner. */
  typeScript: TypeScriptDecision;
  plugins: BuildMigrateConfigParams;
  sources?: string | string[];
  ambientSources?: boolean;
  gitignore?: boolean;
  bootstrap?: boolean;
  maxStablePasses?: number;
  incrementalPasses?: boolean;
  typesPreflight?: boolean;
  typesReportFile?: string;
  suppressionReportFile?: string;
  dryRun?: boolean;
  jsonSummary?: string;
  /**
   * Return the type definition recommendations instead of logging them, for a
   * caller that shows them at the end of a longer run where they will not
   * scroll out of view. A `typesReportFile` is still written either way.
   */
  holdTypesReport?: boolean;
  /** Build the summary without a `--jsonSummary`, for a caller that embeds it. */
  collectSummary?: boolean;
}

export interface RunMigrateOutcome {
  exitCode: number;
  /** Present when a `jsonSummary` file or `collectSummary` asked for it. */
  summary?: MigrateRunSummary;
  /** Present only under `holdTypesReport`, and only when there is anything to say. */
  typesReport?: string;
}

export default async function runMigrate(params: RunMigrateParams): Promise<RunMigrateOutcome> {
  const { rootDir, folder, dryRun = false } = params;
  logTypeScriptDecision(params.typeScript);
  if (params.typesPreflight ?? true) printTypesPackagePreflight(rootDir);

  // Declaring a global or an untyped module beats casting at every site
  // only if the generated file survives the run, which takes a tsconfig
  // this can read and edit. Without one, casting is what still compiles.
  const keepsDeclarations = canKeepGeneratedDeclarations(rootDir);
  const wantsDeclarations =
    (params.plugins.declareGlobals ?? true) || (params.plugins.declareUntypedModules ?? true);
  if (!keepsDeclarations && wantsDeclarations) {
    log.warn(
      `No readable tsconfig.json in ${rootDir}, so a generated declaration file could not ` +
        'be kept in the project. Casting at each site instead.',
    );
  }

  let config: MigrateConfig;
  let typesPackageDetector: TypesPackageDetector | undefined;
  let suppressionExplainer: SuppressionExplainer | undefined;
  let globalDeclarations: GlobalDeclarationsCollector | undefined;
  let aliasDeclarations: { filePath: string; text: string } | null = null;
  try {
    const built = buildMigrateConfig({
      ...params.plugins,
      declareUntypedModules: (params.plugins.declareUntypedModules ?? true) && keepsDeclarations,
      declareGlobals: (params.plugins.declareGlobals ?? true) && keepsDeclarations,
    });
    config = built.config;
    typesPackageDetector = built.typesPackageDetector;
    suppressionExplainer = built.suppressionExplainer;
    globalDeclarations = built.globalDeclarations;
    // Written before the program is created so the aliases resolve during
    // the run; otherwise ts-ignore would suppress every annotation added.
    // A dry run keeps the file in memory and feeds it to the program as a
    // virtual source instead, for the same effect without the write.
    aliasDeclarations = ensureAliasDeclarations({
      rootDir,
      anyAlias: built.anyAlias,
      anyFunctionAlias: built.anyFunctionAlias,
      dryRun,
    });
    if (aliasDeclarations) {
      const aliasPath =
        path.relative(rootDir, aliasDeclarations.filePath) || aliasDeclarations.filePath;
      log.info(
        dryRun
          ? `Dry run: would create ${aliasPath} declaring the global aliases.`
          : `Created ${aliasPath} declaring the global aliases.`,
      );
      // Same requirement as the generated declarations below: a tsconfig
      // that does not match the file leaves every annotation naming an
      // alias unresolved on the next `tsc` run.
      reportGeneratedFileInclusion(rootDir, aliasDeclarations.filePath, aliasPath, dryRun);
    }
  } catch (err) {
    log.error(errorMessage(err));
    return { exitCode: 1 };
  }

  const fileFilters = createMigrationFileFilters(rootDir, {
    gitignore: params.gitignore,
    bootstrap: params.bootstrap,
  });
  const {
    exitCode,
    filesToMigrate,
    emptyMigrationSet,
    updatedSourceFiles,
    updatedFileTexts,
    migratedFilesWithSyntaxErrors,
    nonMigratedFilesWithSyntaxErrors,
    pluginStats,
    pluginFailures,
    pluginNotices,
    pluginErrors,
    generatedFiles,
  } = await migrate({
    rootDir,
    config,
    sources: params.sources,
    ambientSources: params.ambientSources,
    filterMigrationFiles: fileFilters.filterMigrationFiles,
    maxStablePasses: params.maxStablePasses,
    incrementalPasses: params.incrementalPasses,
    dryRun,
    virtualFiles:
      dryRun && aliasDeclarations
        ? [{ fileName: aliasDeclarations.filePath, text: aliasDeclarations.text }]
        : undefined,
  });

  // A run that migrated nothing is otherwise indistinguishable from one
  // that had nothing left to do, and it is the commonest first-run mistake.
  if (emptyMigrationSet) {
    log.error(describeEmptyMigrationSet(emptyMigrationSet, folder));
  }

  // The would-be state of every touched file, including the alias
  // declarations a dry run held back, so the summaries below never
  // depend on what reached the disk.
  const fileContents = new Map(updatedFileTexts);
  if (dryRun && aliasDeclarations) {
    fileContents.set(aliasDeclarations.filePath, aliasDeclarations.text);
  }

  printGeneratedFiles(rootDir, generatedFiles, dryRun);
  // The alias declarations are written before the run rather than by a plugin,
  // and their file is as much a TypeScript-only file as the generated ones.
  const generatedFileParseErrors = await reportGeneratedFileLinting(
    rootDir,
    [
      ...[...generatedFiles].map(([filePath, text]) => ({ filePath, text })),
      ...(aliasDeclarations ? [aliasDeclarations] : []),
    ],
    dryRun,
  );
  if (globalDeclarations) {
    printGlobalDeclarationsReport(globalDeclarations);
  }
  const typesReport = typesPackageDetector
    ? typesPackageReport(typesPackageDetector, rootDir, folder)
    : undefined;
  if (typesReport) {
    if (params.typesReportFile) {
      try {
        fs.writeFileSync(params.typesReportFile, `${typesReport}\n`);
      } catch (err) {
        log.warn(`Skipped writing the type definition recommendations: ${errorMessage(err)}`);
      }
    }
    if (!params.typesReportFile && !params.holdTypesReport) {
      log.info(typesReport);
    }
  }
  if (suppressionExplainer) {
    printSuppressionReport(suppressionExplainer, rootDir, params.suppressionReportFile);
  }
  if (dryRun) {
    printDryRunSummary(rootDir, folder, updatedSourceFiles, fileContents);
  } else {
    printTypeDebtSummary(rootDir, folder, params.gitignore);
  }
  logTypeScriptWarning(params.typeScript);
  printFollowUpReport(pluginNotices);

  const runExitCode = emptyMigrationSet ? -1 : exitCode;
  if (runExitCode !== 0) {
    logRunFailure(pluginErrors, migratedFilesWithSyntaxErrors);
  }

  if (!params.jsonSummary && !params.collectSummary) {
    return { exitCode: runExitCode, typesReport: params.holdTypesReport ? typesReport : undefined };
  }

  const summary = buildMigrateRunSummary({
    command: 'migrate',
    rootDir,
    exitCode: runExitCode,
    dryRun,
    filesToMigrate,
    updatedSourceFiles,
    fileContents,
    migratedFilesWithSyntaxErrors,
    nonMigratedFilesWithSyntaxErrors,
    pluginStats,
    pluginFailures,
    pluginNotices,
    pluginErrors,
    generatedFiles,
    generatedFileParseErrors,
    skippedGitignoredFiles: fileFilters.skippedGitignoredFiles(),
    skippedBootstrapFiles: fileFilters.skippedBootstrapFiles(),
  });

  return {
    // A caller that asked for the summary file must not see success without it.
    exitCode: params.jsonSummary ? writeRunSummary(params.jsonSummary, summary) : runExitCode,
    summary,
    typesReport: params.holdTypesReport ? typesReport : undefined,
  };
}
