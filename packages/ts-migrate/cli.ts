#!/usr/bin/env node

/* eslint-disable no-await-in-loop, no-restricted-syntax */
// Points the process at the project's TypeScript. Must stay the first import:
// the packages below load a compiler at module scope, and the redirect only
// reaches a `require('typescript')` that has not happened yet.
import typeScriptDecision from './utils/useProjectTypeScript';

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import log from 'updatable-log';
import yargs from 'yargs';

import {
  formatGlobalDeclarationsReport,
  formatSuppressionReport,
  formatSuppressionSummary,
  formatTypesPackageReport,
  GlobalDeclarationsCollector,
  SuppressionExplainer,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { errorMessage, migrate, MigrateConfig, MigrateResult } from '@obiemunoz/ts-migrate-server';
import check from './commands/check';
import init from './commands/init';
import buildMigrateConfig, { availablePlugins } from './commands/migrate';
import reignore from './commands/reignore';
import rename from './commands/rename';
import report from './commands/report';
import readAgentsPlaybook from './utils/agentsPlaybook';
import ensureAliasDeclarations from './utils/aliasDeclarations';
import { combineFileFilters, createBootstrapMigrationFilter } from './utils/bootstrapFiles';
import { createGitignoreMigrationFilter } from './utils/gitignore';
import packageVersion from './utils/packageVersion';
import { describeTypeScript, typeScriptWarning } from './utils/resolveTypeScript';
import isIncludedByTsConfig from './utils/tsConfigIncludes';
import {
  buildMigrateRunSummary,
  buildRenameRunSummary,
  writeRunSummary,
} from './utils/runSummary';
import {
  FileDebt,
  formatFileDebtCounts,
  formatTypeDebtSummary,
  scanTypeDebt,
  scanTypeDebtForFiles,
} from './utils/typeDebt';

const BUG_REPORT_URL = 'https://github.com/ObieMunoz/ts-migrate/issues';

/**
 * Every failure a run can expect is reported by the command that raised it, so
 * a throw that reaches the process is a ts-migrate bug. Node prints one as a
 * bare stack, which reads like a finding about the project being migrated;
 * name it as a bug instead and keep what is worth pasting into an issue.
 */
function reportCrash(kind: string, error: unknown): void {
  // A pass counter mid-update would otherwise leave a stale line on screen.
  log.clear();
  let version = 'unknown';
  try {
    version = packageVersion();
  } catch {
    // A crash report is the one thing that must not fail for a missing file.
  }
  log.error(`ts-migrate ${version} hit an unexpected ${kind}. This is a bug in ts-migrate.`);
  // The stack names the failing line; the message carries the cause chain,
  // which the stack leaves out.
  log.error(errorMessage(error));
  if (error instanceof Error && error.stack) log.error(error.stack);
  log.error(`Please report this at ${BUG_REPORT_URL}`);
  process.exit(1);
}

// Registered after the imports above have run, so this covers command
// execution rather than module loading, where a throw means a broken install.
process.on('uncaughtException', (error) => reportCrash('error', error));
process.on('unhandledRejection', (reason) => reportCrash('promise rejection', reason));

const PROJECT_ESLINT_FLAG_DESCRIPTION =
  "Run eslint-fix with the project's own ESLint (node_modules/eslint, searched from " +
  '<folder> upward), so lint rules and plugins see the engine they were written for. ' +
  'Disable with --no-projectEslint to use the ESLint bundled with ts-migrate.';

const TYPESCRIPT_FLAG_DESCRIPTION =
  'Path to the TypeScript package to run with. Defaults to the project\'s own install ' +
  '(node_modules/typescript, searched from <folder> upward), then to the compiler bundled ' +
  'with ts-migrate.';

/**
 * Printed twice: with the banner, and again on the last screen. The banner is
 * in the first three lines of a run that can take many minutes, so by the time
 * the suppressions this qualifies exist it has long scrolled away.
 */
function logTypeScriptWarning(): void {
  const warning = typeScriptWarning(typeScriptDecision());
  if (warning) log.warn(warning);
}

/**
 * Which compiler this run reasoned with, reported from the loaded instance so
 * the banner is what happened rather than what was asked for.
 */
function logTypeScriptDecision(): void {
  const decision = typeScriptDecision();
  log.info(describeTypeScript(decision, ts.version));
  if (ts.version !== decision.version) {
    log.warn(
      `Loaded TypeScript ${ts.version}, not the ${decision.version} at ` +
        `${decision.packageDir}: something else in this process resolves the compiler first.`,
    );
  }
  logTypeScriptWarning();
}

/** A recommendation report must never fail an otherwise successful run. */
function printTypesPackageReport(
  detector: TypesPackageDetector,
  rootDir: string,
  folder: string,
  reportFile?: string,
): void {
  try {
    const reportText = formatTypesPackageReport(detector.summarize(rootDir), folder);
    if (!reportText) return;
    if (reportFile) {
      fs.writeFileSync(reportFile, `${reportText}\n`);
    } else {
      log.info(reportText);
    }
  } catch (err) {
    log.warn(`Skipped type definition recommendations: ${errorMessage(err)}`);
  }
}

/**
 * The evidence the compiler had for every diagnostic ts-ignore suppressed. Only
 * the grouped counts reach the log; the per-site detail goes to reportFile,
 * since stdout is the progress log. Must never fail an otherwise successful run.
 */
function printSuppressionReport(
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
function printGlobalDeclarationsReport(globalDeclarations: GlobalDeclarationsCollector): void {
  try {
    const reportText = formatGlobalDeclarationsReport(globalDeclarations.summarize());
    if (reportText) log.info(reportText);
  } catch (err) {
    log.warn(`Skipped the global declarations report: ${errorMessage(err)}`);
  }
}

/**
 * Names the declaration files the run generated. A generated file the tsconfig
 * does not match is in effect for the migration and nothing after it, so the
 * errors it resolved come back on the next `tsc` run.
 */
function printGeneratedFiles(
  rootDir: string,
  generatedFiles: ReadonlyMap<string, string>,
  dryRun: boolean,
): void {
  generatedFiles.forEach((_text, filePath) => {
    log.info(
      dryRun
        ? `Dry run: would write the generated declarations to ${filePath}.`
        : `Wrote the generated declarations to ${filePath}.`,
    );
    if (dryRun) return;
    try {
      if (!isIncludedByTsConfig(rootDir, filePath)) {
        log.warn(
          `${filePath} is not matched by tsconfig.json, so its declarations only applied to ` +
            'this run. Add it to "include" or "files" to keep them.',
        );
      }
    } catch (err) {
      log.warn(
        'Skipped checking whether tsconfig.json includes the generated declarations: ' +
          errorMessage(err),
      );
    }
  });
}

/**
 * The last line of a failing run. Both causes were logged where they happened,
 * which on a large project is hours and thousands of lines above, and the
 * closing sequence is otherwise identical to a successful run's.
 */
function logRunFailure(
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
function describeEmptyMigrationSet(
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
          'Pass --no-gitignore or --no-bootstrap to include them.',
      );
      break;
    default:
      lines.push('Nothing the program includes is a file this command can edit.');
  }
  return [...lines, ...diagnostics].join('\n');
}

/** The end-of-run debt summary must never fail an otherwise successful run. */
function printTypeDebtSummary(rootDir: string, folder: string, gitignore?: boolean): void {
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
function printDryRunSummary(
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
  lines.push('For full diffs, run without --dry-run on a clean git tree and use git diff.');
  log.info(lines.join('\n'));
}

const version = packageVersion();

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs
  .scriptName('ts-migrate')
  .version(version)
  .usage(`ts-migrate v${version}\n\nUsage: $0 <command> [options]`)
  .command(
    'init <folder>',
    'Initialize tsconfig.json file in <folder>',
    (cmd) => cmd.positional('folder', { type: 'string' }).require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      init({ rootDir, isExtendedConfig: false });
    },
  )
  .command(
    'init:extended <folder>',
    'Initialize tsconfig.json in <folder> extending a shared base config',
    (cmd) => cmd.positional('folder', { type: 'string' }).require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      init({ rootDir, isExtendedConfig: true });
    },
  )
  .command(
    'rename <folder>',
    'Rename files in folder from JS/JSX to TS/TSX',
    (cmd) =>
      cmd
        .positional('folder', { type: 'string' })
        .string('sources')
        .alias('sources', 's')
        .describe('sources', 'Path to a subset of your project to rename.')
        .boolean('gitignore')
        .default('gitignore', true)
        .describe('gitignore', 'Skip gitignored files. Disable with --no-gitignore.')
        .boolean('bootstrap')
        .default('bootstrap', true)
        .describe(
          'bootstrap',
          'Keep build system files (configs and node-run scripts) as JavaScript so the build still boots. Disable with --no-bootstrap.',
        )
        .boolean('dry-run')
        .default('dry-run', false)
        .describe('dry-run', 'Print the rename mapping without renaming any file.')
        .string('jsonSummary')
        .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
        .example('$0 rename /frontend/foo', 'Rename all the files in /frontend/foo')
        .example(
          '$0 rename /frontend/foo -s "bar/**/*"',
          'Rename all the files in /frontend/foo/bar',
        )
        .require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;
      const dryRun = args['dry-run'];
      const result = rename({
        rootDir,
        sources,
        gitignore: args.gitignore,
        bootstrap: args.bootstrap,
        dryRun,
      });
      if (result === null) {
        process.exit(-1);
      }
      if (args.jsonSummary) {
        const exitCode = writeRunSummary(
          args.jsonSummary,
          buildRenameRunSummary({
            rootDir,
            exitCode: 0,
            dryRun,
            renamedFiles: result.renamedFiles,
            skippedGitignoredFiles: result.skippedGitignoredFiles,
            skippedBootstrapFiles: result.skippedBootstrapFiles,
            packageJsonRewrites: result.packageJsonRewrites,
            packageJsonNotices: result.packageJsonNotices,
          }),
        );
        if (exitCode !== 0) process.exit(exitCode);
      }
    },
  )
  .command(
    'migrate <folder>',
    'Fix TypeScript errors, using codemods',
    (cmd) =>
      cmd
        .positional('folder', { type: 'string' })
        .choices('defaultAccessibility', ['private', 'protected', 'public'] as const)
        .describe(
          'defaultAccessibility',
          'Give every class member that declares no accessibility modifier this one. Members matched by one of the regex flags below take that modifier instead.',
        )
        .string('plugin')
        .choices(
          'plugin',
          availablePlugins.map((p) => p.name),
        )
        .describe('plugin', 'Run a specific plugin')
        .string('exclude-plugin')
        .choices(
          'exclude-plugin',
          availablePlugins.map((p) => p.name),
        )
        .describe(
          'exclude-plugin',
          'Skip a plugin of the default pipeline. Repeat the flag to skip several. Excluding infer-types is equivalent to --no-inferTypes.',
        )
        .conflicts('plugin', 'exclude-plugin')
        .string('aliases')
        .choices('aliases', ['tsfixme'] as const)
        .describe(
          'aliases',
          'Annotate with the $TSFixMe/$TSFixMeFunction aliases instead of plain any. The ambient declarations are generated if the project does not already declare them.',
        )
        .string('typeMap')
        .describe('typeMap', 'JSON object mapping JSDoc types to TypeScript types.')
        .boolean('annotateReturns')
        .default('annotateReturns', false)
        .describe(
          'annotateReturns',
          'Also annotate return types from JSDoc @returns. Off by default: a documented return type replaces the one TypeScript infers from the body, which a parameter type does not.',
        )
        .boolean('useDefaultPropsHelper')
        .default('useDefaultPropsHelper', false)
        .describe(
          'useDefaultPropsHelper',
          'Type React defaultProps with a WithDefaultProps helper type. The helper is generated into each migrated file, so no extra module is required.',
        )
        .boolean('modernizeDefaultProps')
        .default('modernizeDefaultProps', true)
        .describe(
          'modernizeDefaultProps',
          'Move the defaultProps of a function component into its props destructuring, which React 19 requires. Only conversions that keep the same behavior are made; the rest keep the assignment and are typed instead. Disable with --no-modernizeDefaultProps.',
        )
        .string('privateRegex')
        .describe(
          'privateRegex',
          'Mark class members whose name matches this regular expression private.',
        )
        .string('protectedRegex')
        .describe(
          'protectedRegex',
          'Mark class members whose name matches this regular expression protected, unless --privateRegex already matched.',
        )
        .string('publicRegex')
        .describe(
          'publicRegex',
          'Mark class members whose name matches this regular expression public, unless one of the two flags above already matched.',
        )
        .string('sources')
        .alias('sources', 's')
        .describe('sources', 'Path to a subset of your project to migrate (globs are ok).')
        .boolean('ambientSources')
        .default('ambientSources', true)
        .describe(
          'ambientSources',
          'With --sources, keep the .d.ts files from your tsconfig in the program so ambient types still resolve. Disable with --no-ambientSources.',
        )
        .boolean('gitignore')
        .default('gitignore', true)
        .describe(
          'gitignore',
          'Skip gitignored files: they are neither migrated nor added to the program. Disable with --no-gitignore.',
        )
        .boolean('bootstrap')
        .default('bootstrap', true)
        .describe(
          'bootstrap',
          'Skip build system files (configs and node-run scripts): they are kept out of the program. They stay JavaScript either way, since migrate never edits JavaScript files. Disable with --no-bootstrap.',
        )
        .boolean('inferTypes')
        .default('inferTypes', true)
        .describe(
          'inferTypes',
          'Infer types from usage before falling back to any. Disable with --no-inferTypes.',
        )
        .boolean('jsdoc')
        .default('jsdoc', true)
        .describe(
          'jsdoc',
          'Convert the types JSDoc documents into annotations, so a documented parameter keeps its type instead of falling back to any. Disable with --no-jsdoc.',
        )
        .boolean('projectEslint')
        .default('projectEslint', true)
        .describe('projectEslint', PROJECT_ESLINT_FLAG_DESCRIPTION)
        .number('maxStablePasses')
        .default('maxStablePasses', 5)
        .describe(
          'maxStablePasses',
          'Maximum number of passes for plugins that repeat until files stop changing.',
        )
        .boolean('incrementalPasses')
        .default('incrementalPasses', true)
        .describe(
          'incrementalPasses',
          'Revisit only files affected by the previous pass when repeating plugins. Disable with --no-incrementalPasses.',
        )
        .boolean('declareUntypedModules')
        .default('declareUntypedModules', true)
        .describe(
          'declareUntypedModules',
          'Declare the imported packages that ship no type definitions in types/ts-migrate-modules.d.ts, instead of suppressing every import of them. Disable with --no-declareUntypedModules.',
        )
        .boolean('declareGlobals')
        .default('declareGlobals', true)
        .describe(
          'declareGlobals',
          'Declare the properties the code assigns to window, global and globalThis in types/ts-migrate-globals.d.ts, instead of casting every read and write of them. Disable with --no-declareGlobals.',
        )
        .string('typescript')
        .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
        .string('typesReportFile')
        .describe(
          'typesReportFile',
          'Write the type definition recommendations to this file instead of printing them. Used by ts-migrate-full to show the report at the end of the run.',
        )
        .string('suppressionReportFile')
        .describe(
          'suppressionReportFile',
          'Write what the compiler knew about every suppressed diagnostic to this file: the full message and its chain, the related information, and the resolved signatures and types. The comment keeps the code and 50 characters of the message, and nothing can recover the rest afterwards.',
        )
        .boolean('dry-run')
        .default('dry-run', false)
        .describe(
          'dry-run',
          'Run every plugin pass but write nothing to disk; print the files a real run would update. Takes as long as a real run.',
        )
        .string('jsonSummary')
        .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
        .example('$0 migrate /frontend/foo', 'Migrate all the files in /frontend/foo')
        .example(
          '$0 migrate /frontend/foo -s "bar/**/*"',
          'Migrate all the files in /frontend/foo/bar. Ambient .d.ts files from the tsconfig stay in the program.',
        )
        .example(
          '$0 migrate /frontend/foo --plugin jsdoc',
          'Migrate JSDoc comments for all the files in /frontend/foo',
        )
        .example(
          '$0 migrate /frontend/foo --exclude-plugin ts-ignore --exclude-plugin strip-ts-ignore',
          'Migrate /frontend/foo, leaving residual errors unsuppressed for manual fixing',
        )
        .require(['folder']),
    async (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;
      const dryRun = args['dry-run'];
      logTypeScriptDecision();

      let config: MigrateConfig;
      let typesPackageDetector: TypesPackageDetector | undefined;
      let suppressionExplainer: SuppressionExplainer | undefined;
      let globalDeclarations: GlobalDeclarationsCollector | undefined;
      let aliasDeclarations: { filePath: string; text: string } | null = null;
      try {
        const built = buildMigrateConfig({
          plugin: args.plugin,
          excludePlugins: ([] as string[]).concat(args['exclude-plugin'] ?? []),
          aliases: args.aliases,
          typeMap: args.typeMap,
          annotateReturns: args.annotateReturns,
          useDefaultPropsHelper: args.useDefaultPropsHelper,
          modernizeDefaultProps: args.modernizeDefaultProps,
          defaultAccessibility: args.defaultAccessibility,
          privateRegex: args.privateRegex,
          protectedRegex: args.protectedRegex,
          publicRegex: args.publicRegex,
          inferTypes: args.inferTypes,
          jsdoc: args.jsdoc,
          projectEslint: args.projectEslint,
          declareUntypedModules: args.declareUntypedModules,
          declareGlobals: args.declareGlobals,
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
          log.info(
            dryRun
              ? `Dry run: would create ${aliasDeclarations.filePath} declaring the global aliases.`
              : `Created ${aliasDeclarations.filePath} declaring the global aliases.`,
          );
        }
      } catch (err) {
        log.error(errorMessage(err));
        process.exit(1);
        return;
      }

      const gitignoreFilter = args.gitignore
        ? createGitignoreMigrationFilter(rootDir)
        : undefined;
      const bootstrapFilter = args.bootstrap
        ? createBootstrapMigrationFilter(rootDir)
        : undefined;
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
        pluginErrors,
        generatedFiles,
      } = await migrate({
        rootDir,
        config,
        sources,
        ambientSources: args.ambientSources,
        filterMigrationFiles: combineFileFilters([gitignoreFilter, bootstrapFilter]),
        maxStablePasses: args.maxStablePasses,
        incrementalPasses: args.incrementalPasses,
        dryRun,
        virtualFiles:
          dryRun && aliasDeclarations
            ? [{ fileName: aliasDeclarations.filePath, text: aliasDeclarations.text }]
            : undefined,
      });

      // A run that migrated nothing is otherwise indistinguishable from one
      // that had nothing left to do, and it is the commonest first-run mistake.
      if (emptyMigrationSet) {
        log.error(describeEmptyMigrationSet(emptyMigrationSet, args.folder));
      }

      // The would-be state of every touched file, including the alias
      // declarations a dry run held back, so the summaries below never
      // depend on what reached the disk.
      const fileContents = new Map(updatedFileTexts);
      if (dryRun && aliasDeclarations) {
        fileContents.set(aliasDeclarations.filePath, aliasDeclarations.text);
      }

      printGeneratedFiles(rootDir, generatedFiles, dryRun);
      if (globalDeclarations) {
        printGlobalDeclarationsReport(globalDeclarations);
      }
      if (typesPackageDetector) {
        printTypesPackageReport(typesPackageDetector, rootDir, args.folder, args.typesReportFile);
      }
      if (suppressionExplainer) {
        printSuppressionReport(suppressionExplainer, rootDir, args.suppressionReportFile);
      }
      if (dryRun) {
        printDryRunSummary(rootDir, args.folder, updatedSourceFiles, fileContents);
      } else {
        printTypeDebtSummary(rootDir, args.folder, args.gitignore);
      }
      logTypeScriptWarning();

      const runExitCode = emptyMigrationSet ? -1 : exitCode;
      if (runExitCode !== 0) {
        logRunFailure(pluginErrors, migratedFilesWithSyntaxErrors);
      }

      let finalExitCode = runExitCode;
      if (args.jsonSummary) {
        finalExitCode = writeRunSummary(
          args.jsonSummary,
          buildMigrateRunSummary({
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
            pluginErrors,
            generatedFiles,
            skippedGitignoredFiles: gitignoreFilter?.skippedFiles().length ?? 0,
            skippedBootstrapFiles: bootstrapFilter?.skippedFiles() ?? [],
          }),
        );
      }

      process.exit(finalExitCode);
    },
  )
  .command(
    'reignore <folder>',
    'Re-run ts-ignore on a project',
    (cmd) =>
      cmd
        .option('p', {
          alias: 'messagePrefix',
          default: 'FIXME',
          type: 'string',
          describe:
            'A message to add to the ts-expect-error or ts-ignore comments that are inserted.',
        })
        .positional('folder', { type: 'string' })
        .string('sources')
        .alias('sources', 's')
        .describe('sources', 'Path to a subset of your project to reignore (globs are ok).')
        .boolean('ambientSources')
        .default('ambientSources', true)
        .describe(
          'ambientSources',
          'With --sources, keep the .d.ts files from your tsconfig in the program so ambient types still resolve. Disable with --no-ambientSources.',
        )
        .boolean('gitignore')
        .default('gitignore', true)
        .describe(
          'gitignore',
          'Skip gitignored files: they are neither reignored nor added to the program. Disable with --no-gitignore.',
        )
        .boolean('bootstrap')
        .default('bootstrap', true)
        .describe(
          'bootstrap',
          'Skip build system files (configs and node-run scripts): they are kept out of the program. They stay JavaScript either way, since reignore never edits JavaScript files. Disable with --no-bootstrap.',
        )
        .boolean('projectEslint')
        .default('projectEslint', true)
        .describe('projectEslint', PROJECT_ESLINT_FLAG_DESCRIPTION)
        .boolean('declareUntypedModules')
        .default('declareUntypedModules', true)
        .describe(
          'declareUntypedModules',
          'Declare the imported packages that ship no type definitions in types/ts-migrate-modules.d.ts, instead of suppressing every import of them. Disable with --no-declareUntypedModules.',
        )
        .boolean('casts')
        .default('casts', false)
        .describe(
          'casts',
          'Retry the `as any` assertions ts-migrate inserted: drop each one, re-check the file, and keep the removal only where no new error appears. Off by default, since it costs a validation pass per file holding one.',
        )
        .string('typescript')
        .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
        .string('suppressionReportFile')
        .describe(
          'suppressionReportFile',
          'Write what the compiler knew about every suppressed diagnostic to this file, as in migrate.',
        )
        .boolean('dry-run')
        .default('dry-run', false)
        .describe(
          'dry-run',
          'Run every plugin pass but write nothing to disk; print the files a real run would update. Takes as long as a real run.',
        )
        .string('jsonSummary')
        .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
        .example(
          '$0 reignore /frontend/foo -s "bar/**/*"',
          'Reignore all the files in /frontend/foo/bar. Ambient .d.ts files from the tsconfig stay in the program.',
        )
        .require(['folder']),
    async (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;
      const dryRun = args['dry-run'];
      logTypeScriptDecision();

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
        pluginErrors,
        generatedFiles,
        skippedGitignoredFiles,
        skippedBootstrapFiles,
      } = await reignore({
        rootDir,
        sources,
        ambientSources: args.ambientSources,
        messagePrefix: args.p,
        gitignore: args.gitignore,
        bootstrap: args.bootstrap,
        projectEslint: args.projectEslint,
        declareUntypedModules: args.declareUntypedModules,
        casts: args.casts,
        dryRun,
      });

      printGeneratedFiles(rootDir, generatedFiles, dryRun);
      printTypesPackageReport(typesPackageDetector, rootDir, args.folder);
      printSuppressionReport(suppressionExplainer, rootDir, args.suppressionReportFile);
      if (dryRun) {
        printDryRunSummary(rootDir, args.folder, updatedSourceFiles, updatedFileTexts);
      } else {
        printTypeDebtSummary(rootDir, args.folder, args.gitignore);
      }
      logTypeScriptWarning();

      if (exitCode !== 0) {
        logRunFailure(pluginErrors, migratedFilesWithSyntaxErrors);
      }

      let finalExitCode = exitCode;
      if (args.jsonSummary) {
        finalExitCode = writeRunSummary(
          args.jsonSummary,
          buildMigrateRunSummary({
            command: 'reignore',
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
            pluginErrors,
            generatedFiles,
            skippedGitignoredFiles,
            skippedBootstrapFiles,
          }),
        );
      }

      process.exit(finalExitCode);
    },
  )
  .command(
    'report <folder>',
    'Print per-file counts of suppression comments and any-type annotations',
    (cmd) =>
      cmd
        .positional('folder', { type: 'string' })
        .boolean('json')
        .default('json', false)
        .describe('json', 'Print the report as JSON for machine consumption.')
        .boolean('gitignore')
        .default('gitignore', true)
        .describe('gitignore', 'Leave gitignored files uncounted. Disable with --no-gitignore.')
        .example('$0 report /frontend/foo', 'Report the type debt of /frontend/foo')
        .example('$0 report /frontend/foo --json', 'Same counts as JSON')
        .require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      process.exit(
        report({ rootDir, folder: args.folder, json: args.json, gitignore: args.gitignore }),
      );
    },
  )
  .command(
    'check <folder>',
    'Compare suppression and any counts against a committed baseline',
    (cmd) =>
      cmd
        .positional('folder', { type: 'string' })
        .boolean('update-baseline')
        .default('update-baseline', false)
        .describe(
          'update-baseline',
          'Accept the current counts as the new baseline, even if they grew.',
        )
        .string('baselineFile')
        .describe(
          'baselineFile',
          'Path of the baseline JSON. Defaults to .ts-migrate-baseline.json in <folder>.',
        )
        .boolean('gitignore')
        .default('gitignore', true)
        .describe('gitignore', 'Leave gitignored files uncounted. Disable with --no-gitignore.')
        .string('typescript')
        .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
        .example(
          '$0 check /frontend/foo',
          'Exit nonzero if any per-file count exceeds the baseline; lower the baseline on improvement',
        )
        .example(
          '$0 check /frontend/foo --update-baseline',
          'Accept the current counts as the new baseline',
        )
        .require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      process.exit(
        check({
          rootDir,
          folder: args.folder,
          updateBaseline: args['update-baseline'],
          baselineFile: args.baselineFile,
          gitignore: args.gitignore,
        }),
      );
    },
  )
  .command(
    'agents',
    'Print usage instructions for AI coding agents (non-interactive playbook)',
    (cmd) => cmd,
    () => {
      process.stdout.write(readAgentsPlaybook());
    },
  )
  .example('$0 --help', 'Show help')
  .example('$0 migrate --help', 'Show help for the migrate command')
  .example('$0 init frontend/foo', 'Create tsconfig.json file at frontend/foo/tsconfig.json')
  .example(
    '$0 init:extended frontend/foo',
    'Create extended from the base tsconfig.json file at frontend/foo/tsconfig.json',
  )
  .example('$0 rename frontend/foo', 'Rename files in frontend/foo from JS/JSX to TS/TSX')
  .example(
    '$0 rename frontend/foo --s "bar/baz"',
    'Rename files in frontend/foo/bar/baz from JS/JSX to TS/TSX',
  )
  .example('$0 agents', 'Print the agent playbook')
  .epilogue(
    'AI coding agents: run `npx -p @obiemunoz/ts-migrate ts-migrate agents` for the full ' +
      'non-interactive usage playbook.',
  )
  .demandCommand(1, 'Must provide a command.')
  // demandCommand only counts positionals, so a name that matches no command
  // reaches here. Options stay unchecked: ts-migrate-full forwards one argument
  // list to both rename and migrate, which accept different flags.
  .strictCommands()
  // Near misses fail with the command they were probably meant to be, before
  // strictCommands reports them as unknown.
  .recommendCommands()
  .help('h')
  .alias('h', 'help')
  .alias('v', 'version')
  // terminalWidth() is null when stdout is not a TTY, and yargs does not wrap
  // at all on a falsy width, so piped and redirected help falls back to 100.
  .wrap(Math.min(yargs.terminalWidth() || 100, 100)).argv;
