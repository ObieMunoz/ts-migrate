#!/usr/bin/env node

/* eslint-disable no-await-in-loop, no-restricted-syntax */
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import yargs from 'yargs';

import { formatTypesPackageReport, TypesPackageDetector } from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import init from './commands/init';
import buildMigrateConfig, { availablePlugins } from './commands/migrate';
import reignore from './commands/reignore';
import rename from './commands/rename';
import readAgentsPlaybook from './utils/agentsPlaybook';
import packageVersion from './utils/packageVersion';

/** A recommendation report must never fail an otherwise successful run. */
function printTypesPackageReport(
  detector: TypesPackageDetector,
  rootDir: string,
  folder: string,
  reportFile?: string,
): void {
  try {
    const report = formatTypesPackageReport(detector.summarize(rootDir), folder);
    if (!report) return;
    if (reportFile) {
      fs.writeFileSync(reportFile, `${report}\n`);
    } else {
      log.info(report);
    }
  } catch (err) {
    log.warn('Skipped type definition recommendations:', err);
  }
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
        .example('$0 rename /frontend/foo', 'Rename all the files in /frontend/foo')
        .example(
          '$0 rename /frontend/foo -s "bar/**/*"',
          'Rename all the files in /frontend/foo/bar',
        )
        .require(['folder']),
    (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;
      const renamedFiles = rename({ rootDir, sources });
      if (renamedFiles === null) {
        process.exit(-1);
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

      let config: MigrateConfig;
      let typesPackageDetector: TypesPackageDetector | undefined;
      try {
        ({ config, typesPackageDetector } = buildMigrateConfig({
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
        }));
      } catch (err) {
        log.error(err instanceof Error ? err.message : err);
        process.exit(1);
        return;
      }

      const { exitCode } = await migrate({
        rootDir,
        config,
        sources,
        ambientSources: args.ambientSources,
        maxStablePasses: args.maxStablePasses,
        incrementalPasses: args.incrementalPasses,
      });

      if (typesPackageDetector) {
        printTypesPackageReport(typesPackageDetector, rootDir, args.folder, args.typesReportFile);
      }

      process.exit(exitCode);
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
        .example(
          '$0 reignore /frontend/foo -s "bar/**/*"',
          'Reignore all the files in /frontend/foo/bar. Ambient .d.ts files from the tsconfig stay in the program.',
        )
        .require(['folder']),
    async (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;

      const { exitCode, typesPackageDetector } = await reignore({
        rootDir,
        sources,
        ambientSources: args.ambientSources,
        messagePrefix: args.p,
      });

      printTypesPackageReport(typesPackageDetector, rootDir, args.folder);

      process.exit(exitCode);
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
