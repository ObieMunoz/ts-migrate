#!/usr/bin/env node

/* eslint-disable no-await-in-loop, no-restricted-syntax */
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import yargs from 'yargs';

import { formatTypesPackageReport, TypesPackageDetector } from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import check from './commands/check';
import init from './commands/init';
import buildMigrateConfig, { availablePlugins } from './commands/migrate';
import reignore from './commands/reignore';
import rename from './commands/rename';
import report from './commands/report';
import readAgentsPlaybook from './utils/agentsPlaybook';
import ensureAliasDeclarations from './utils/aliasDeclarations';
import { createGitignoreMigrationFilter } from './utils/gitignore';
import packageVersion from './utils/packageVersion';
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
    log.warn('Skipped type definition recommendations:', err);
  }
}

/** The end-of-run debt summary must never fail an otherwise successful run. */
function printTypeDebtSummary(rootDir: string, folder: string, gitignore?: boolean): void {
  try {
    log.info(formatTypeDebtSummary(scanTypeDebt(rootDir, gitignore), folder));
  } catch (err) {
    log.warn('Skipped type debt summary:', err);
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
    log.warn('Skipped the suppression counts of the dry run summary:', err);
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
    'Initialize tsconfig.json file in <folder>',
    (cmd) => cmd.positional('folder', { type: 'string' }).require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      init({ rootDir, isExtendedConfig: true });
    },
  )
  .command(
    'rename [options] <folder>',
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
      const result = rename({ rootDir, sources, gitignore: args.gitignore, dryRun });
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
          }),
        );
        if (exitCode !== 0) process.exit(exitCode);
      }
    },
  )
  .command(
    'migrate [options] <folder>',
    'Fix TypeScript errors, using codemods',
    (cmd) =>
      cmd
        .positional('folder', { type: 'string' })
        .choices('defaultAccessibility', ['private', 'protected', 'public'] as const)
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
        .describe(
          'typeMap',
          'JSON object mapping JSDoc types to TypeScript types, used with --plugin jsdoc.',
        )
        .boolean('useDefaultPropsHelper')
        .default('useDefaultPropsHelper', false)
        .describe(
          'useDefaultPropsHelper',
          'Type React defaultProps with a WithDefaultProps helper type. The helper is generated into each migrated file, so no extra module is required.',
        )
        .string('privateRegex')
        .string('protectedRegex')
        .string('publicRegex')
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
        .boolean('inferTypes')
        .default('inferTypes', true)
        .describe(
          'inferTypes',
          'Infer types from usage before falling back to any. Disable with --no-inferTypes.',
        )
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
        .string('typesReportFile')
        .describe(
          'typesReportFile',
          'Write the type definition recommendations to this file instead of printing them. Used by ts-migrate-full to show the report at the end of the run.',
        )
        .boolean('dry-run')
        .default('dry-run', false)
        .describe(
          'dry-run',
          'Run every plugin pass but write nothing to disk; print the files a real run would update. Takes as long as a real run.',
        )
        .string('jsonSummary')
        .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
        .example('migrate /frontend/foo', 'Migrate all the files in /frontend/foo')
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

      let config: MigrateConfig;
      let typesPackageDetector: TypesPackageDetector | undefined;
      let aliasDeclarations: { filePath: string; text: string } | null = null;
      try {
        const built = buildMigrateConfig({
          plugin: args.plugin,
          excludePlugins: ([] as string[]).concat(args['exclude-plugin'] ?? []),
          aliases: args.aliases,
          typeMap: args.typeMap,
          useDefaultPropsHelper: args.useDefaultPropsHelper,
          defaultAccessibility: args.defaultAccessibility,
          privateRegex: args.privateRegex,
          protectedRegex: args.protectedRegex,
          publicRegex: args.publicRegex,
          inferTypes: args.inferTypes,
        });
        config = built.config;
        typesPackageDetector = built.typesPackageDetector;
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
        log.error(err instanceof Error ? err.message : err);
        process.exit(1);
        return;
      }

      const gitignoreFilter = args.gitignore
        ? createGitignoreMigrationFilter(rootDir)
        : undefined;
      const {
        exitCode,
        updatedSourceFiles,
        updatedFileTexts,
        nonMigratedFilesWithSyntaxErrors,
        pluginStats,
      } = await migrate({
        rootDir,
        config,
        sources,
        ambientSources: args.ambientSources,
        filterMigrationFiles: gitignoreFilter?.filterMigrationFiles,
        maxStablePasses: args.maxStablePasses,
        incrementalPasses: args.incrementalPasses,
        dryRun,
        virtualFiles:
          dryRun && aliasDeclarations
            ? [{ fileName: aliasDeclarations.filePath, text: aliasDeclarations.text }]
            : undefined,
      });

      // The would-be state of every touched file, including the alias
      // declarations a dry run held back, so the summaries below never
      // depend on what reached the disk.
      const fileContents = new Map(updatedFileTexts);
      if (dryRun && aliasDeclarations) {
        fileContents.set(aliasDeclarations.filePath, aliasDeclarations.text);
      }

      if (typesPackageDetector) {
        printTypesPackageReport(typesPackageDetector, rootDir, args.folder, args.typesReportFile);
      }
      if (dryRun) {
        printDryRunSummary(rootDir, args.folder, updatedSourceFiles, fileContents);
      } else {
        printTypeDebtSummary(rootDir, args.folder, args.gitignore);
      }

      let finalExitCode = exitCode;
      if (args.jsonSummary) {
        finalExitCode = writeRunSummary(
          args.jsonSummary,
          buildMigrateRunSummary({
            command: 'migrate',
            rootDir,
            exitCode,
            dryRun,
            updatedSourceFiles,
            fileContents,
            nonMigratedFilesWithSyntaxErrors,
            pluginStats,
            skippedGitignoredFiles: gitignoreFilter?.skippedFiles().length ?? 0,
          }),
        );
      }

      process.exit(finalExitCode);
    },
  )
  .command(
    'reignore [options] <folder>',
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

      const {
        exitCode,
        typesPackageDetector,
        updatedSourceFiles,
        updatedFileTexts,
        nonMigratedFilesWithSyntaxErrors,
        pluginStats,
        skippedGitignoredFiles,
      } = await reignore({
        rootDir,
        sources,
        ambientSources: args.ambientSources,
        messagePrefix: args.p,
        gitignore: args.gitignore,
        dryRun,
      });

      printTypesPackageReport(typesPackageDetector, rootDir, args.folder);
      if (dryRun) {
        printDryRunSummary(rootDir, args.folder, updatedSourceFiles, updatedFileTexts);
      } else {
        printTypeDebtSummary(rootDir, args.folder, args.gitignore);
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
            updatedSourceFiles,
            fileContents: updatedFileTexts,
            nonMigratedFilesWithSyntaxErrors,
            pluginStats,
            skippedGitignoredFiles,
          }),
        );
      }

      process.exit(finalExitCode);
    },
  )
  .command(
    'report [options] <folder>',
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
    'check [options] <folder>',
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
  .help('h')
  .alias('h', 'help')
  .alias('v', 'version')
  .alias('i', 'init')
  .alias('m', 'migrate')
  .alias('rn', 'rename')
  .alias('ri', 'reignore')
  .wrap(Math.min(yargs.terminalWidth(), 100)).argv;
