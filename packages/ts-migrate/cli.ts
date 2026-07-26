#!/usr/bin/env node

/* eslint-disable no-await-in-loop, no-restricted-syntax */
// Points the process at the project's TypeScript. Must stay the first import:
// the packages below load a compiler at module scope, and the redirect only
// reaches a `require('typescript')` that has not happened yet.
import typeScriptDecision from './utils/useProjectTypeScript';

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import log from 'updatable-log';
import yargs, { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';

import { errorMessage } from '@obiemunoz/ts-migrate-server';
import check from './commands/check';
import full, { Prompter } from './commands/full';
import init from './commands/init';
import { availablePlugins, BuildMigrateConfigParams } from './commands/migrate';
import reignore from './commands/reignore';
import rename from './commands/rename';
import report from './commands/report';
import runMigrate from './commands/runMigrate';
import readAgentsPlaybook from './utils/agentsPlaybook';
import {
  CONFIG_FLAG_DESCRIPTION,
  findConfigFile,
  readConfigFile,
} from './utils/configFile';
import packageVersion from './utils/packageVersion';
import { migrationRootFromArgv } from './utils/resolveTypeScript';
import {
  logConfigFile,
  logRunFailure,
  logTypeScriptDecision,
  logTypeScriptWarning,
  printDryRunSummary,
  printFollowUpReport,
  printGeneratedFiles,
  printSuppressionReport,
  printTypeDebtSummary,
  printTypesPackagePreflight,
  typesPackageReport,
} from './utils/runReports';
import { canKeepGeneratedDeclarations } from './utils/tsConfigIncludes';
import {
  buildMigrateRunSummary,
  buildRenameRunSummary,
  writeRunSummary,
} from './utils/runSummary';

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
  'Disable with --projectEslint=false to use the ESLint bundled with ts-migrate.';

const TYPESCRIPT_FLAG_DESCRIPTION =
  'Path to the TypeScript package to run with. Defaults to the project\'s own install ' +
  '(node_modules/typescript, searched from <folder> upward), then to the compiler bundled ' +
  'with ts-migrate.';

const TYPES_PREFLIGHT_FLAG_DESCRIPTION =
  'Name the type packages the project declares dependencies for but has not installed before ' +
  'the pipeline starts, so they can be installed instead of suppressed. Disable with ' +
  '--typesPreflight=false.';

/**
 * The <folder> positional every command takes, resolved against the working
 * directory. A path that is not a directory holds no tsconfig.json, so the
 * commands that go looking for one next would report the config file rather
 * than the path that was actually mistyped. -1 is the code the other commands
 * already exit with when they cannot start.
 */
function resolveRootDir(folder: string): string {
  const rootDir = path.resolve(process.cwd(), folder);
  if (!fs.existsSync(rootDir)) {
    log.error(`${rootDir} does not exist`);
    process.exit(-1);
  }
  if (!fs.statSync(rootDir).isDirectory()) {
    log.error(`${rootDir} is not a directory`);
    process.exit(-1);
  }
  return rootDir;
}

/**
 * The flags the migration pipeline takes. `migrate` runs the pipeline directly
 * and `full` runs it as one of four steps, so both declare this set; generic
 * over the argument type so each keeps the arguments yargs infers for it.
 */
function migrationFlags<T>(cmd: Argv<T>) {
  return cmd
    .choices('defaultAccessibility', ['private', 'protected', 'public'] as const)
    .describe(
      'defaultAccessibility',
      'Give every class member that declares no accessibility modifier this one. Members matched by one of the regex flags below take that modifier instead.',
    )
    .string('excludePlugin')
    .choices(
      'excludePlugin',
      availablePlugins.map((p) => p.name),
    )
    .describe(
      'excludePlugin',
      'Skip a plugin of the default pipeline. Repeat the flag to skip several. Excluding infer-types is equivalent to --inferTypes=false.',
    )
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
      'Move the defaultProps of a function component into its props destructuring, which React 19 requires. Only conversions that keep the same behavior are made; the rest keep the assignment and are typed instead. Disable with --modernizeDefaultProps=false.',
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
      'With --sources, keep the .d.ts files from your tsconfig in the program so ambient types still resolve. Disable with --ambientSources=false.',
    )
    .boolean('gitignore')
    .default('gitignore', true)
    .describe(
      'gitignore',
      'Skip gitignored files: they are neither migrated nor added to the program. Disable with --gitignore=false.',
    )
    .boolean('bootstrap')
    .default('bootstrap', true)
    .describe(
      'bootstrap',
      'Skip build system files (configs and node-run scripts): they are kept out of the program. They stay JavaScript either way, since migrate never edits JavaScript files. Disable with --bootstrap=false.',
    )
    .boolean('inferTypes')
    .default('inferTypes', true)
    .describe(
      'inferTypes',
      'Infer types from usage before falling back to any. Disable with --inferTypes=false.',
    )
    .boolean('jsdoc')
    .default('jsdoc', true)
    .describe(
      'jsdoc',
      'Convert the types JSDoc documents into annotations, so a documented parameter keeps its type instead of falling back to any. Disable with --jsdoc=false.',
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
      'Revisit only files affected by the previous pass when repeating plugins. Disable with --incrementalPasses=false.',
    )
    .boolean('declareUntypedModules')
    .default('declareUntypedModules', true)
    .describe(
      'declareUntypedModules',
      'Declare the imported packages that ship no type definitions in types/ts-migrate-modules.d.ts, instead of suppressing every import of them. The file is added to the tsconfig if it does not already match it. Disable with --declareUntypedModules=false.',
    )
    .boolean('declareGlobals')
    .default('declareGlobals', true)
    .describe(
      'declareGlobals',
      'Declare the properties the code assigns to window, global and globalThis in types/ts-migrate-globals.d.ts, instead of casting every read and write of them. The file is added to the tsconfig if it does not already match it. Disable with --declareGlobals=false.',
    )
    .string('typescript')
    .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
    .boolean('typesPreflight')
    .default('typesPreflight', true)
    .describe('typesPreflight', TYPES_PREFLIGHT_FLAG_DESCRIPTION)
    .string('suppressionReportFile')
    .describe(
      'suppressionReportFile',
      'Write what the compiler knew about every suppressed diagnostic to this file: the full message and its chain, the related information, and the resolved signatures and types. The comment keeps the code and 50 characters of the message, and nothing can recover the rest afterwards.',
    );
}

/**
 * The flags the pipeline reads through its plugin options, as the shape
 * `buildMigrateConfig` takes. Read off the parsed arguments in one place so
 * `migrate` and `full` cannot pass different subsets of the same flags.
 */
interface PipelineArgs {
  plugin?: string | string[];
  excludePlugin?: string | string[];
  aliases?: 'tsfixme';
  typeMap?: string;
  annotateReturns?: boolean;
  useDefaultPropsHelper?: boolean;
  modernizeDefaultProps?: boolean;
  defaultAccessibility?: 'private' | 'protected' | 'public';
  privateRegex?: string;
  protectedRegex?: string;
  publicRegex?: string;
  inferTypes?: boolean;
  jsdoc?: boolean;
  projectEslint?: boolean;
  declareUntypedModules?: boolean;
  declareGlobals?: boolean;
}

function pluginParams(args: PipelineArgs): BuildMigrateConfigParams {
  return {
    plugin: args.plugin,
    excludePlugins: ([] as string[]).concat(args.excludePlugin ?? []),
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
  };
}

/**
 * The terminal answering the `full` pipeline's questions.
 *
 * Every line is queued as it arrives rather than read through `rl.question`.
 * Piped answers reach the process in one chunk, and readline hands a chunk to
 * whatever question is pending at that instant and emits the rest as `line`
 * events with nowhere to go, so a question asked after the first `await` would
 * find its answer already read and discarded.
 *
 * The prompt goes to stderr, where a shell's own `read -p` puts it, so it stays
 * out of a redirected transcript.
 */
function createPrompter(): Prompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    // Off a terminal there is nothing to echo, and readline's line editing
    // would rewrite the prompt this writes itself.
    terminal: process.stdin.isTTY === true,
  });
  const answers: string[] = [];
  let waiting: ((answer: string | null) => void) | undefined;
  let closed = false;

  const deliver = (answer: string | null) => {
    const resolve = waiting;
    waiting = undefined;
    resolve?.(answer);
  };
  rl.on('line', (line) => (waiting ? deliver(line) : answers.push(line)));
  rl.on('close', () => {
    closed = true;
    deliver(null);
  });

  return {
    ask: (question) =>
      new Promise((resolve) => {
        process.stderr.write(question);
        if (answers.length > 0) resolve(answers.shift() as string);
        else if (closed) resolve(null);
        else waiting = resolve;
      }),
    close: () => {
      rl.close();
      // readline leaves stdin flowing, which would hold the process open long
      // after the last question is answered.
      process.stdin.pause();
    },
  };
}

const version = packageVersion();

// yargs 18 removed the singleton, so the chain below runs against an instance
// and `hideBin` drops the two argv entries the singleton used to skip itself.
const cli = yargs(hideBin(process.argv));

/**
 * The config file this run reads, found once from the folder being migrated.
 * Read off raw argv for the same reason the compiler is: a command declares
 * `--config` as it is built, which happens before anything has been parsed.
 */
const discoveredConfigFile = findConfigFile(
  migrationRootFromArgv(hideBin(process.argv), process.cwd()),
);

/**
 * The flag names each command takes, which is what a config file's keys are
 * checked against. Built by running each command's own builder against a
 * throwaway parser, so it cannot drift from what the commands declare.
 *
 * Computed on first use rather than up front: the builders below are what it
 * reads, and one of them is running when it is asked for.
 */
let flagSets: Record<string, ReadonlySet<string>> | undefined;
function flagsByCommand(): Record<string, ReadonlySet<string>> {
  flagSets ??= Object.fromEntries(
    Object.entries(commandBuilders).map(([name, builder]) => [
      name,
      new Set(Object.keys(builder(yargs([])).getOptions().key)),
    ]),
  );
  return flagSets;
}

/**
 * `--config`, and the file it falls back to. Declared per command because
 * reading the file takes both the section that names the command and the set
 * of flags that command accepts.
 */
function configFlag<T>(cmd: Argv<T>, command: string) {
  return cmd
    .config('config', CONFIG_FLAG_DESCRIPTION, (configPath) =>
      readConfigFile({ configPath, command, flagsByCommand: flagsByCommand() }),
    )
    .default('config', discoveredConfigFile);
}

const fullBuilder = (cmd: Argv) =>
  migrationFlags(configFlag(cmd.positional('folder', { type: 'string' }), 'full'))
    .boolean('yes')
    .alias('yes', 'y')
    .default('yes', false)
    .describe('yes', 'Accept the prompts without asking. Required for an unattended run.')
    .boolean('commit')
    .default('commit', true)
    .describe(
      'commit',
      'Commit after each step that wrote something. Disable with --commit=false to leave every change in the working tree.',
    )
    .boolean('blameIgnoreRevs')
    .default('blameIgnoreRevs', false)
    .describe(
      'blameIgnoreRevs',
      'Append the SHAs of this run\'s commits to .git-blame-ignore-revs at the repository root. Only useful on merge-commit workflows; with squash or rebase merges those SHAs never reach the main branch.',
    )
    .boolean('dryRun')
    .default('dryRun', false)
    .describe(
      'dryRun',
      'Preview the steps that can run without writes and stop before the migration, which reads the files the rename would have written. Nothing is written and nothing is committed.',
    )
    .string('typesReportFile')
    .describe(
      'typesReportFile',
      'Also write the type definition recommendations to this file. They are printed at the end of the run either way, which is what this command holds them back for.',
    )
    .string('jsonSummary')
    .describe(
      'jsonSummary',
      'Write a machine-readable JSON summary of the whole run to this file: every step with its status and commit, plus the rename and migrate summaries.',
    )
    .example('$0 full /frontend/foo', 'Migrate /frontend/foo end to end, committing each step')
    .example(
      '$0 full /frontend/foo --yes --commit=false',
      'The same run unattended, leaving every change in the working tree',
    )
    .require(['folder']);

const initBuilder = (cmd: Argv) =>
  cmd.positional('folder', { type: 'string' }).require(['folder']);

const renameBuilder = (cmd: Argv) =>
  configFlag(cmd.positional('folder', { type: 'string' }), 'rename')
    .string('sources')
    .alias('sources', 's')
    .describe('sources', 'Path to a subset of your project to rename.')
    .boolean('gitignore')
    .default('gitignore', true)
    .describe('gitignore', 'Skip gitignored files. Disable with --gitignore=false.')
    .boolean('bootstrap')
    .default('bootstrap', true)
    .describe(
      'bootstrap',
      'Keep build system files (configs and node-run scripts) as JavaScript so the build still boots. Disable with --bootstrap=false.',
    )
    .boolean('dryRun')
    .default('dryRun', false)
    .describe('dryRun', 'Print the rename mapping without renaming any file.')
    .string('jsonSummary')
    .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
    .example('$0 rename /frontend/foo', 'Rename all the files in /frontend/foo')
    .example('$0 rename /frontend/foo -s "bar/**/*"', 'Rename all the files in /frontend/foo/bar')
    .require(['folder']);

const migrateBuilder = (cmd: Argv) =>
  migrationFlags(configFlag(cmd.positional('folder', { type: 'string' }), 'migrate'))
    // Only here, and not on `full`: a single plugin leaves the errors the
    // rest of the pipeline would have resolved, so the compile check that
    // closes a full run would fail by construction.
    .string('plugin')
    .choices(
      'plugin',
      availablePlugins.map((p) => p.name),
    )
    .describe('plugin', 'Run a specific plugin')
    .conflicts('plugin', 'excludePlugin')
    .string('typesReportFile')
    .describe(
      'typesReportFile',
      'Write the type definition recommendations to this file instead of printing them.',
    )
    .boolean('dryRun')
    .default('dryRun', false)
    .describe(
      'dryRun',
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
      '$0 migrate /frontend/foo --excludePlugin ts-ignore --excludePlugin strip-ts-ignore',
      'Migrate /frontend/foo, leaving residual errors unsuppressed for manual fixing',
    )
    .require(['folder']);

const reignoreBuilder = (cmd: Argv) =>
  configFlag(cmd.positional('folder', { type: 'string' }), 'reignore')
    .option('messagePrefix', {
      alias: 'p',
      default: 'FIXME',
      type: 'string',
      describe: 'A message to add to the ts-expect-error or ts-ignore comments that are inserted.',
    })
    .string('sources')
    .alias('sources', 's')
    .describe('sources', 'Path to a subset of your project to reignore (globs are ok).')
    .boolean('ambientSources')
    .default('ambientSources', true)
    .describe(
      'ambientSources',
      'With --sources, keep the .d.ts files from your tsconfig in the program so ambient types still resolve. Disable with --ambientSources=false.',
    )
    .boolean('gitignore')
    .default('gitignore', true)
    .describe(
      'gitignore',
      'Skip gitignored files: they are neither reignored nor added to the program. Disable with --gitignore=false.',
    )
    .boolean('bootstrap')
    .default('bootstrap', true)
    .describe(
      'bootstrap',
      'Skip build system files (configs and node-run scripts): they are kept out of the program. They stay JavaScript either way, since reignore never edits JavaScript files. Disable with --bootstrap=false.',
    )
    .boolean('projectEslint')
    .default('projectEslint', true)
    .describe('projectEslint', PROJECT_ESLINT_FLAG_DESCRIPTION)
    .boolean('declareUntypedModules')
    .default('declareUntypedModules', true)
    .describe(
      'declareUntypedModules',
      'Declare the imported packages that ship no type definitions in types/ts-migrate-modules.d.ts, instead of suppressing every import of them. The file is added to the tsconfig if it does not already match it. Disable with --declareUntypedModules=false.',
    )
    .boolean('casts')
    .default('casts', false)
    .describe(
      'casts',
      'Retry the `as any` assertions ts-migrate inserted: drop each one, re-check the file, and keep the removal only where no new error appears. An assertion the file still needs is narrowed to the tightest type the checker can name for it, on the same evidence. Off by default, since it costs up to two validation passes per file holding one.',
    )
    .string('typescript')
    .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
    .boolean('typesPreflight')
    .default('typesPreflight', true)
    .describe('typesPreflight', TYPES_PREFLIGHT_FLAG_DESCRIPTION)
    .string('suppressionReportFile')
    .describe(
      'suppressionReportFile',
      'Write what the compiler knew about every suppressed diagnostic to this file, as in migrate.',
    )
    .boolean('dryRun')
    .default('dryRun', false)
    .describe(
      'dryRun',
      'Run every plugin pass but write nothing to disk; print the files a real run would update. Takes as long as a real run.',
    )
    .string('jsonSummary')
    .describe('jsonSummary', 'Write a machine-readable JSON summary of the run to this file.')
    .example(
      '$0 reignore /frontend/foo -s "bar/**/*"',
      'Reignore all the files in /frontend/foo/bar. Ambient .d.ts files from the tsconfig stay in the program.',
    )
    .require(['folder']);

const reportBuilder = (cmd: Argv) =>
  configFlag(cmd.positional('folder', { type: 'string' }), 'report')
    .boolean('json')
    .default('json', false)
    .describe('json', 'Print the report as JSON for machine consumption.')
    .boolean('gitignore')
    .default('gitignore', true)
    .describe('gitignore', 'Leave gitignored files uncounted. Disable with --gitignore=false.')
    .example('$0 report /frontend/foo', 'Report the type debt of /frontend/foo')
    .example('$0 report /frontend/foo --json', 'Same counts as JSON')
    .require(['folder']);

const checkBuilder = (cmd: Argv) =>
  configFlag(cmd.positional('folder', { type: 'string' }), 'check')
    .boolean('updateBaseline')
    .default('updateBaseline', false)
    .describe('updateBaseline', 'Accept the current counts as the new baseline, even if they grew.')
    .string('baselineFile')
    .describe(
      'baselineFile',
      'Path of the baseline JSON. Defaults to .ts-migrate-baseline.json in <folder>.',
    )
    .boolean('gitignore')
    .default('gitignore', true)
    .describe('gitignore', 'Leave gitignored files uncounted. Disable with --gitignore=false.')
    .string('typescript')
    .describe('typescript', TYPESCRIPT_FLAG_DESCRIPTION)
    .example(
      '$0 check /frontend/foo',
      'Exit nonzero if any per-file count exceeds the baseline; lower the baseline on improvement',
    )
    .example(
      '$0 check /frontend/foo --updateBaseline',
      'Accept the current counts as the new baseline',
    )
    .require(['folder']);

const agentsBuilder = (cmd: Argv) => cmd;

/**
 * Every command by name. The config file's section names are checked against
 * these, and the flags each command takes are read back off these builders.
 * `init`, `init:extended` and `agents` take no flags, so they declare no
 * `--config` and a section naming one of them has nothing to set.
 */
const commandBuilders: Record<string, (cmd: Argv) => Argv<any>> = {
  full: fullBuilder,
  init: initBuilder,
  'init:extended': initBuilder,
  rename: renameBuilder,
  migrate: migrateBuilder,
  reignore: reignoreBuilder,
  report: reportBuilder,
  check: checkBuilder,
  agents: agentsBuilder,
};

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
cli
  .scriptName('ts-migrate')
  .version(version)
  .usage(`ts-migrate v${version}\n\nUsage: $0 <command> [options]`)
  // Every flag is spelled in camelCase, matching tsc and the tsconfig.json
  // these users already work in, and the dashed spelling of one parses too,
  // so `--dry-run` and `--exclude-plugin` keep working wherever they are
  // already written. Set rather than left to the default because that second
  // half is what makes them work, and it is not a default worth inheriting
  // by accident.
  //
  // Its companion `strip-dashed` is deliberately absent. It drops the key a
  // flag was declared under, which is the one `choices` validates against, so
  // it turns a flag declared in kebab-case into one that accepts any value in
  // silence. Nothing here is declared that way today, and leaving the setting
  // off means nothing has to stay that way to keep the validation.
  .parserConfiguration({ 'camel-case-expansion': true })
  .command(
    'full <folder>',
    'Run the whole pipeline: init, rename, migrate, then verify with tsc --noEmit',
    fullBuilder,
    async (args) => {
      const rootDir = resolveRootDir(args.folder);
      logConfigFile(args.config);
      const { exitCode, summary } = await full({
        rootDir,
        folder: args.folder,
        typeScript: typeScriptDecision(),
        typeScriptOverride: args.typescript,
        yes: args.yes,
        commit: args.commit,
        blameIgnoreRevs: args.blameIgnoreRevs,
        dryRun: args.dryRun,
        jsonSummary: args.jsonSummary,
        renameOptions: {
          sources: args.sources,
          gitignore: args.gitignore,
          bootstrap: args.bootstrap,
        },
        migrateOptions: {
          plugins: pluginParams(args),
          sources: args.sources,
          ambientSources: args.ambientSources,
          gitignore: args.gitignore,
          bootstrap: args.bootstrap,
          maxStablePasses: args.maxStablePasses,
          incrementalPasses: args.incrementalPasses,
          typesPreflight: args.typesPreflight,
          typesReportFile: args.typesReportFile,
          suppressionReportFile: args.suppressionReportFile,
          collectSummary: true,
        },
        prompter: args.yes ? undefined : createPrompter(),
      });
      // Not process.exit: this command prints four steps' worth of reports, and
      // exiting drops whatever of that is still queued on a pipe.
      process.exitCode = args.jsonSummary
        ? writeRunSummary(args.jsonSummary, summary)
        : exitCode;
    },
  )
  .command(
    'init <folder>',
    'Initialize tsconfig.json file in <folder>',
    initBuilder,
    (args) => {
      const rootDir = resolveRootDir(args.folder);
      init({ rootDir, isExtendedConfig: false });
    },
  )
  .command(
    'init:extended <folder>',
    'Initialize tsconfig.json in <folder> extending a shared base config',
    initBuilder,
    (args) => {
      const rootDir = resolveRootDir(args.folder);
      init({ rootDir, isExtendedConfig: true });
    },
  )
  .command(
    'rename <folder>',
    'Rename files in folder from JS/JSX to TS/TSX',
    renameBuilder,
    (args) => {
      const rootDir = resolveRootDir(args.folder);
      logConfigFile(args.config);
      const { sources, dryRun } = args;
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
    migrateBuilder,
    async (args) => {
      const rootDir = resolveRootDir(args.folder);
      logConfigFile(args.config);
      const { exitCode } = await runMigrate({
        rootDir,
        folder: args.folder,
        typeScript: typeScriptDecision(),
        plugins: pluginParams(args),
        sources: args.sources,
        ambientSources: args.ambientSources,
        gitignore: args.gitignore,
        bootstrap: args.bootstrap,
        maxStablePasses: args.maxStablePasses,
        incrementalPasses: args.incrementalPasses,
        typesPreflight: args.typesPreflight,
        typesReportFile: args.typesReportFile,
        suppressionReportFile: args.suppressionReportFile,
        dryRun: args.dryRun,
        jsonSummary: args.jsonSummary,
      });
      process.exit(exitCode);
    },
  )
  .command(
    'reignore <folder>',
    'Re-run ts-ignore on a project',
    reignoreBuilder,
    async (args) => {
      const rootDir = resolveRootDir(args.folder);
      const { sources, dryRun } = args;
      logConfigFile(args.config);
      logTypeScriptDecision(typeScriptDecision());
      if (args.typesPreflight) printTypesPackagePreflight(rootDir);

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
        sources,
        ambientSources: args.ambientSources,
        messagePrefix: args.messagePrefix,
        gitignore: args.gitignore,
        bootstrap: args.bootstrap,
        projectEslint: args.projectEslint,
        // See the migrate command: without a tsconfig to keep it in, a
        // generated declaration file is undone by the next `tsc` run.
        declareUntypedModules: args.declareUntypedModules && canKeepGeneratedDeclarations(rootDir),
        casts: args.casts,
        dryRun,
      });

      printGeneratedFiles(rootDir, generatedFiles, dryRun);
      const typesReport = typesPackageReport(typesPackageDetector, rootDir, args.folder);
      if (typesReport) log.info(typesReport);
      printSuppressionReport(suppressionExplainer, rootDir, args.suppressionReportFile);
      if (dryRun) {
        printDryRunSummary(rootDir, args.folder, updatedSourceFiles, updatedFileTexts);
      } else {
        printTypeDebtSummary(rootDir, args.folder, args.gitignore);
      }
      logTypeScriptWarning(typeScriptDecision());
      printFollowUpReport(pluginNotices);

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
            pluginNotices,
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
    reportBuilder,
    (args) => {
      const rootDir = resolveRootDir(args.folder);
      // Under --json the report is the whole of stdout, so nothing else may
      // be written there.
      if (!args.json) logConfigFile(args.config);
      process.exit(
        report({ rootDir, folder: args.folder, json: args.json, gitignore: args.gitignore }),
      );
    },
  )
  .command(
    'check <folder>',
    'Compare suppression and any counts against a committed baseline',
    checkBuilder,
    (args) => {
      const rootDir = resolveRootDir(args.folder);
      logConfigFile(args.config);
      process.exit(
        check({
          rootDir,
          folder: args.folder,
          updateBaseline: args.updateBaseline,
          baselineFile: args.baselineFile,
          gitignore: args.gitignore,
        }),
      );
    },
  )
  .command(
    'agents',
    'Print usage instructions for AI coding agents (non-interactive playbook)',
    agentsBuilder,
    () => {
      process.stdout.write(readAgentsPlaybook());
    },
  )
  .example('$0 --help', 'Show help')
  .example('$0 full frontend/foo', 'Run the whole pipeline over frontend/foo')
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
  // reaches here, and so does an option no command declares. Options went
  // unchecked while the ts-migrate-full script forwarded one argument list to
  // both rename and migrate, which accept different flags; `full` declares that
  // union itself now, so a flag nothing accepts is a typo, and silently
  // ignoring one costs a whole migration run to notice.
  // Kept apart rather than as .strict(): that reports an unknown command name
  // as an unknown argument and drops the "Unknown command" line these two
  // produce, which is what names the thing that was actually mistyped.
  .strictCommands()
  .strictOptions()
  // Near misses fail with the command they were probably meant to be, before
  // strictCommands reports them as unknown.
  .recommendCommands()
  .help('h')
  .alias('h', 'help')
  .alias('v', 'version')
  // terminalWidth() is null when stdout is not a TTY, and yargs does not wrap
  // at all on a falsy width, so piped and redirected help falls back to 100.
  .wrap(Math.min(cli.terminalWidth() || 100, 100)).argv;
