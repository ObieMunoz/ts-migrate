#!/usr/bin/env node

/* eslint-disable no-await-in-loop, no-restricted-syntax */
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import yargs from 'yargs';

import {
  addConversionsPlugin,
  declareMissingClassPropertiesPlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  hoistArrowFunctionsPlugin,
  hoistClassStaticsPlugin,
  hoistDeclarationsPlugin,
  inferTypesPlugin,
  jsDocPlugin,
  memberAccessibilityPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
  createTypesPackageDetector,
  formatTypesPackageReport,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import init from './commands/init';
import reignore from './commands/reignore';
import rename from './commands/rename';
import readAgentsPlaybook from './utils/agentsPlaybook';

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

const availablePlugins = [
  addConversionsPlugin,
  declareMissingClassPropertiesPlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  hoistArrowFunctionsPlugin,
  hoistClassStaticsPlugin,
  hoistDeclarationsPlugin,
  inferTypesPlugin,
  jsDocPlugin,
  memberAccessibilityPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
];

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs
  .scriptName('ts-migrate')
  .version(false)
  .usage('Usage: $0 <command> [options]')
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
        .string('privateRegex')
        .string('protectedRegex')
        .string('publicRegex')
        .string('sources')
        .alias('sources', 's')
        .describe('sources', 'Path to a subset of your project to migrate (globs are ok).')
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
          '$0 migrate /frontend/foo -s "bar/**/*" -s "node_modules/**/*.d.ts"',
          'Migrate all the files in /frontend/foo/bar, accounting for ambient types from node_modules.',
        )
        .example(
          '$0 migrate /frontend/foo --plugin jsdoc',
          'Migrate JSDoc comments for all the files in /frontend/foo',
        )
        .require(['folder']),
    async (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;
      let config: MigrateConfig;
      let typesPackageDetector: TypesPackageDetector | undefined;

      const airbnbAnyAlias = '$TSFixMe';
      const airbnbAnyFunctionAlias = '$TSFixMeFunction';
      // by default, we're not going to use any aliases in ts-migrate
      const anyAlias = args.aliases === 'tsfixme' ? airbnbAnyAlias : undefined;
      const anyFunctionAlias = args.aliases === 'tsfixme' ? airbnbAnyFunctionAlias : undefined;

      if (args.plugin) {
        const plugin = availablePlugins.find((cur) => cur.name === args.plugin);
        if (!plugin) {
          log.error(`Could not find a plugin named ${args.plugin}.`);
          process.exit(1);
          return;
        }
        if (plugin === jsDocPlugin) {
          const anyAlias = args.aliases === 'tsfixme' ? '$TSFixMe' : undefined;
          const typeMap = typeof args.typeMap === 'string' ? JSON.parse(args.typeMap) : undefined;
          config = new MigrateConfig().addPlugin(jsDocPlugin, { anyAlias, typeMap });
        } else {
          config = new MigrateConfig().addPlugin(plugin, {
            anyAlias,
            anyFunctionAlias,
          });
        }
      } else {
        const useDefaultPropsHelper = args.useDefaultPropsHelper === 'true';

        const { defaultAccessibility, privateRegex, protectedRegex, publicRegex } = args;

        config = new MigrateConfig()
          .addPlugin(updateImportPathsPlugin, {})
          .addPlugin(stripTSIgnorePlugin, {})
          .addPlugin(reactInlineImportedPropTypesPlugin, {})
          .addPlugin(hoistClassStaticsPlugin, { anyAlias })
          .addPlugin(hoistArrowFunctionsPlugin, {})
          .addPlugin(hoistDeclarationsPlugin, {})
          .addPlugin(reactPropsPlugin, {
            anyAlias,
            anyFunctionAlias,
            shouldUpdateAirbnbImports: true,
          })
          .addPlugin(reactClassStatePlugin, { anyAlias })
          .addPlugin(reactClassLifecycleMethodsPlugin, { force: true })
          .addPlugin(reactDefaultPropsPlugin, {
            useDefaultPropsHelper,
          })
          .addPlugin(reactShapePlugin, {
            anyAlias,
            anyFunctionAlias,
          })
          .addPlugin(declareMissingClassPropertiesPlugin, { anyAlias })
          .addPlugin(memberAccessibilityPlugin, {
            defaultAccessibility,
            privateRegex,
            protectedRegex,
            publicRegex,
          });
        if (args.inferTypes) {
          // Annotations from one pass can surface new implicit anys (e.g. a
          // variable annotated `any` makes its callback parameters implicit
          // any), so these two repeat until the files stop changing.
          config
            .addPlugin(inferTypesPlugin, {}, { repeatUntilStable: true })
            .addPlugin(explicitAnyPlugin, { anyAlias }, { repeatUntilStable: true });
        } else {
          config.addPlugin(explicitAnyPlugin, { anyAlias });
        }
        typesPackageDetector = createTypesPackageDetector();
        config
          .addPlugin(addConversionsPlugin, { anyAlias })
          // We need to run eslint-fix before ts-ignore because formatting may affect where
          // the errors are that need to get ignored.
          .addPlugin(eslintFixPlugin, {})
          // Recommends @types packages from the diagnostics ts-ignore is about
          // to suppress, so it must run before they are hidden.
          .addPlugin(typesPackageDetector.plugin, {})
          .addPlugin(tsIgnorePlugin, {})
          // We need to run eslint-fix again after ts-ignore to fix up formatting.
          .addPlugin(eslintFixPlugin, {});
      }

      const { exitCode } = await migrate({
        rootDir,
        config,
        sources,
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
        .example(
          '$0 reignore /frontend/foo -s "bar/**/*" -s "node_modules/**/*.d.ts"',
          'Reignore all the files in /frontend/foo/bar, accounting for ambient types from node_modules.',
        )
        .require(['folder']),
    async (args) => {
      const rootDir = path.resolve(process.cwd(), args.folder);
      const { sources } = args;

      const { exitCode, typesPackageDetector } = await reignore({
        rootDir,
        sources,
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
  .alias('i', 'init')
  .alias('m', 'migrate')
  .alias('rn', 'rename')
  .alias('ri', 'reignore')
  .wrap(Math.min(yargs.terminalWidth(), 100)).argv;
