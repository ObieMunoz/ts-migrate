import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'updatable-log';

import { errorMessage } from '@obiemunoz/ts-migrate-server';
import init from './init';
import rename from './rename';
import runMigrate, { RunMigrateParams } from './runMigrate';
import isIncludedByTsConfig from '../utils/tsConfigIncludes';
import { eslintTypeScriptSupport, hasTypeScriptBuild } from '../utils/projectTooling';
import { checkerSkewWarning, TypeScriptDecision } from '../utils/resolveTypeScript';
import { buildRenameRunSummary, FullRunStep, FullRunSummary } from '../utils/runSummary';
import packageVersion from '../utils/packageVersion';

const ISSUES_URL = 'https://github.com/ObieMunoz/ts-migrate/issues';

const STEP_COUNT = 4;

/**
 * The declaration files a run can generate. A tsconfig that does not match one
 * puts it in the migration's own program and no later one, so the check reports
 * every name it declares as undefined.
 */
const GENERATED_DECLARATIONS = [
  'types/ts-migrate-globals.d.ts',
  'types/ts-migrate-modules.d.ts',
  'ts-migrate-aliases.d.ts',
];

/**
 * Answers the run's two questions. A prompt is one implementation of "confirm":
 * the steps and their guards are the command, and `--yes` is the implementation
 * that answers without asking.
 */
export interface Prompter {
  /** The line the user typed, or null when there is no input to read. */
  ask(question: string): Promise<string | null>;
  close(): void;
}

export interface FullParams {
  rootDir: string;
  /**
   * The folder as the user wrote it. Every message names this rather than the
   * resolved path, and the shell script this replaced never normalized it
   * either, so `./src`, `src` and `src/` each read back the way they were typed.
   */
  folder: string;
  /** The compiler this process was redirected at. */
  typeScript: TypeScriptDecision;
  /** The `--typescript` value, repeated in the reignore hint printed on failure. */
  typeScriptOverride?: string;
  yes: boolean;
  commit: boolean;
  blameIgnoreRevs: boolean;
  dryRun: boolean;
  jsonSummary?: string;
  /** Forwarded to the rename step. */
  renameOptions: {
    sources?: string | string[];
    gitignore?: boolean;
    bootstrap?: boolean;
  };
  /** Forwarded to the migrate step, minus what this command decides itself. */
  migrateOptions: Omit<
    RunMigrateParams,
    | 'rootDir'
    | 'folder'
    | 'typeScript'
    | 'dryRun'
    | 'jsonSummary'
    | 'holdTypesReport'
    | 'collectSummary'
  >;
  /** Absent under `--yes`, which is the path that answers without asking. */
  prompter?: Prompter;
}

export interface FullOutcome {
  exitCode: number;
  summary: FullRunSummary;
}

/**
 * Child output, forwarded a line at a time so the transcript reads as though
 * the commands had been run by hand. It goes through the same log the steps
 * write to rather than straight to the file descriptor: two writers on one
 * stream is two orderings, since Node writes a pipe asynchronously and a
 * terminal synchronously.
 */
class LineWriter {
  private partial = '';

  write(chunk: string): void {
    const lines = (this.partial + chunk).split('\n');
    this.partial = lines.pop() ?? '';
    lines.forEach((line) => log.important(line));
  }

  /** Emits whatever the child left without a closing newline. */
  flush(): void {
    if (this.partial === '') return;
    log.important(this.partial);
    this.partial = '';
  }
}

/** Child output that is known to arrive whole, as every git invocation here does. */
function writeThrough(text: string): void {
  if (!text) return;
  const writer = new LineWriter();
  writer.write(text);
  writer.flush();
}

function git(rootDir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', rootDir, ...args], { encoding: 'utf-8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** The name the welcome screen suggests a migration branch be called after. */
function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    // No passwd entry for this uid, which happens in containers.
    return process.env.USER || process.env.LOGNAME || 'you';
  }
}

/**
 * A scoped run must be reignored with the same scope, with the same compiler,
 * and with the same lint engine, so the hint printed on failure repeats the
 * flags this run was invoked with.
 */
function reignoreCommand(params: FullParams): string {
  let command = `npx -p @obiemunoz/ts-migrate ts-migrate reignore "${params.folder}"`;
  const sources = params.renameOptions.sources ?? params.migrateOptions.sources;
  const list = sources === undefined ? [] : [sources].flat();
  list.forEach((source) => {
    command += ` --sources "${source}"`;
  });
  if (params.migrateOptions.plugins.projectEslint === false) {
    command += ' --projectEslint=false';
  }
  if (params.typeScriptOverride) {
    command += ` --typescript "${params.typeScriptOverride}"`;
  }
  return command;
}

export default async function full(params: FullParams): Promise<FullOutcome> {
  return new FullRun(params).run();
}

class FullRun {
  private readonly params: FullParams;

  /** Reset to false the moment a run finds it cannot commit. */
  private commit: boolean;

  private inGitWorkTree = false;

  /** Full SHAs of the mechanical commits this run creates, newest last. */
  private readonly commits: Array<{ sha: string; subject: string }> = [];

  private readonly steps: FullRunStep[] = [];

  /**
   * Held back until the end of the run, where it will not scroll out of view.
   * On a failure these recommendations are the only thing left to act on, so
   * they also go to a file that outlives the run.
   */
  private typesReport?: string;

  private typesReportShown = false;

  private renameSummary: FullRunSummary['rename'] = null;

  private migrateSummary: FullRunSummary['migrate'] = null;

  /** Set only by the prompt below; empty means the check runs the migration's compiler. */
  private customTscPath = '';

  /** Set when Step 1 wrote the tsconfig, so Step 3 does not repeat its advice. */
  private initSaidTypesPreflight = false;

  constructor(params: FullParams) {
    this.params = params;
    // A dry run has nothing to commit: every step it reaches writes nothing.
    this.commit = params.commit && !params.dryRun;
  }

  async run(): Promise<FullOutcome> {
    const { params } = this;

    this.welcome();
    this.preflightGitTree();

    const stopped = await this.preflightPrompts();
    if (stopped !== undefined) return this.outcome(stopped);

    const initFailure = this.stepInit();
    if (initFailure !== undefined) return this.outcome(initFailure);

    const renameFailure = this.stepRename();
    if (renameFailure !== undefined) return this.outcome(renameFailure);

    if (params.dryRun) return this.outcome(this.stopDryRun());

    const migrateFailure = await this.stepMigrate();
    if (migrateFailure !== undefined) return this.outcome(migrateFailure);

    const check = await this.stepCheck();
    if (check !== 0) return this.outcome(check);

    log.info(`
---
All done! Your project compiles with TypeScript now.`);
    this.showTypesReport();
    this.closingChecklist();
    return this.outcome(0);
  }

  // -- preflight ------------------------------------------------------------

  private welcome(): void {
    const { folder } = this.params;
    const user = currentUser();
    const folderName = path.basename(folder);
    log.info(`Welcome to TS Migrate! :D

This command will migrate a frontend folder to a compiling (or almost compiling) TS project.

It is recommended that you take the following steps before continuing...

1. Make sure you have a clean git slate.
   Run \`git status\` to make sure you have no local changes that may get lost.
   Check in or stash your changes, then re-run this command.

2. Check out a new branch for the migration.
   For example, \`git checkout -b ${user}--ts-migrate\` if you're migrating several folders or
   \`git checkout -b ${user}--ts-migrate-${folderName}\` if you're just migrating ${folder}.

3. Make sure you're on the latest, clean master.
   \`git fetch origin master && git reset --hard origin/master\`

4. Make sure you have the latest npm modules installed.
   \`npm install\` or \`yarn install\`

5. For a cleaner result, install type definitions for your environment first,
   e.g. \`npm i -D @types/node\` plus the @types for your test runner (mocha, jest, ...).
   With those in place, globals like \`require\` and \`describe\` get real types
   instead of suppressed errors.

If you need help or have feedback, please file an issue at ${ISSUES_URL}
`);
  }

  /**
   * The tree state that matters is what the `git add .` below would stage, so
   * this asks the same question with the same scope.
   */
  private preflightGitTree(): void {
    const { rootDir, folder, dryRun } = this.params;
    if (git(rootDir, ['rev-parse', '--is-inside-work-tree']).status !== 0) {
      if (this.commit) {
        log.info(`${folder} is not in a git repository, so this run cannot commit its
steps. Continuing as though --commit=false had been passed.
`);
        this.commit = false;
      }
      return;
    }
    this.inGitWorkTree = true;

    const status = git(rootDir, ['status', '--porcelain', '.']);
    if (status.status !== 0) return;
    const dirty = status.stdout.split('\n').filter((line) => line !== '');
    if (dirty.length === 0) return;

    log.info(`Uncommitted changes in ${folder} (${dirty.length}):`);
    log.info(dirty.slice(0, 10).map((line) => `  ${line}`).join('\n'));
    if (dirty.length > 10) {
      log.info(`  ... and ${dirty.length - 10} more`);
    }
    if (dryRun) {
      log.info(`
A dry run writes nothing, so those files are safe here. A real run renames and
rewrites them in place. Set them aside with \`git stash -u\` first.`);
    } else if (this.commit) {
      log.info(`
Steps 2 and 3 rename and rewrite those files in place, and \`git add .\` puts them
in this run's commits, attributed to the migration. Set them aside with
\`git stash -u\` first.`);
    } else {
      log.info(`
Steps 2 and 3 rename and rewrite those files in place, and an untracked one has
no committed copy to recover it from. Set them aside with \`git stash -u\` first.`);
    }
    if (this.params.yes) {
      log.info('--yes was passed, so the run continues.');
    }
    log.info('');
  }

  /** The exit code to stop on, or undefined to carry on to Step 1. */
  private async preflightPrompts(): Promise<number | undefined> {
    const { params } = this;
    if (params.yes) return undefined;

    const { prompter } = params;
    if (!prompter) {
      log.info('No input available; re-run with --yes to skip the prompts.');
      return 1;
    }
    try {
      const answer = await prompter.ask('Continue? (y/N) ');
      if (answer === null) {
        log.info('No input available; re-run with --yes to skip the prompts.');
        return 1;
      }
      if (answer !== 'y' && answer !== 'Y') {
        log.info('See you later.');
        return 0;
      }

      const customTsc = await prompter.ask(
        "Set a custom path for the typescript compiler. (It's an optional step. Skip if you " +
          "don't need it. By default the check runs the same compiler the migration used.): ",
      );
      if (!customTsc) {
        log.info('The check will run the same compiler the migration used.');
        return undefined;
      }
      this.customTscPath = customTsc;
      return this.preflightCheckerSkew(prompter);
    } finally {
      prompter.close();
    }
  }

  /**
   * Compares the compiler the check would run with the one the migrate step
   * resolved, and refuses to start on a mismatch. A skew is only found at Step 4
   * otherwise, after every plugin pass has already derived its suppressions from
   * the other compiler. Reachable only through the custom tsc prompt above:
   * `--typescript` applies to both steps, and `--yes` sets no custom path.
   */
  private async preflightCheckerSkew(prompter: Prompter): Promise<number | undefined> {
    // A path the check cannot execute is not used at Step 4 either; it falls
    // back to the migration's compiler, which is by definition no skew.
    if (!isExecutable(this.customTscPath)) return undefined;
    const checkVersion = readTscVersion(this.customTscPath);
    if (!checkVersion) return undefined;

    const warning = checkerSkewWarning(this.params.typeScript, {
      version: checkVersion,
      path: this.customTscPath,
    });
    if (!warning) return undefined;

    log.info(`
${warning}
`);
    const answer = await prompter.ask('Continue anyway? (y/N) ');
    if (answer === null) {
      log.info('No input available; nothing has been changed.');
      return 1;
    }
    if (answer !== 'y' && answer !== 'Y') {
      log.info('Stopping before Step 1; nothing has been changed.');
      return 1;
    }
    return undefined;
  }

  // -- steps ----------------------------------------------------------------

  private stepInit(): number | undefined {
    const { rootDir, folder, dryRun } = this.params;
    log.info(`
[Step 1 of ${STEP_COUNT}] Initializing ts-config for the "${folder}"...
`);

    if (fs.existsSync(path.join(rootDir, 'tsconfig.json'))) {
      this.steps.push({ name: 'init', status: 'skipped', exitCode: null, commit: null });
      return undefined;
    }

    if (dryRun) {
      log.info(`Dry run: would create ${folder}/tsconfig.json.`);
      this.steps.push({ name: 'init', status: 'skipped', exitCode: null, commit: null });
      return undefined;
    }

    // init names the type packages worth installing before the pipeline; the
    // migrate step says it instead whenever a tsconfig already exists and
    // Step 1 has nothing to do.
    this.initSaidTypesPreflight = true;
    let wroteConfig: boolean;
    try {
      wroteConfig = init({ rootDir, isExtendedConfig: false });
    } catch (err) {
      log.error(errorMessage(err));
      wroteConfig = false;
    }
    if (!wroteConfig || !fs.existsSync(path.join(rootDir, 'tsconfig.json'))) {
      return this.failStep('init', `Step 1 of ${STEP_COUNT} (init)`, 1);
    }
    return this.finishStep(
      'init',
      `Step 1 of ${STEP_COUNT} (init)`,
      `[ts-migrate][${path.basename(folder)}] Init tsconfig.json file`,
    );
  }

  private stepRename(): number | undefined {
    const { rootDir, folder, dryRun, renameOptions } = this.params;

    log.info(`
[Step 2 of ${STEP_COUNT}] Renaming files from JS/JSX to TS/TSX and updating project.json...
`);

    // The rename reads the tsconfig Step 1 would have written, so on a project
    // that has none there is no mapping to preview.
    if (dryRun && !fs.existsSync(path.join(rootDir, 'tsconfig.json'))) {
      log.info(
        `Dry run: the rename reads ${folder}/tsconfig.json to decide which files it covers, ` +
          `and Step 1 wrote none, so there is no mapping to preview. Run \`ts-migrate init ` +
          `${folder}\` first to preview the rename.`,
      );
      this.steps.push({ name: 'rename', status: 'skipped', exitCode: null, commit: null });
      return undefined;
    }

    let result;
    try {
      result = rename({ rootDir, ...renameOptions, dryRun });
    } catch (err) {
      log.error(errorMessage(err));
      result = null;
    }
    if (result === null) {
      return this.failStep('rename', `Step 2 of ${STEP_COUNT} (rename)`, 255);
    }

    this.renameSummary = buildRenameRunSummary({
      rootDir,
      exitCode: 0,
      dryRun,
      renamedFiles: result.renamedFiles,
      skippedGitignoredFiles: result.skippedGitignoredFiles,
      skippedBootstrapFiles: result.skippedBootstrapFiles,
      packageJsonRewrites: result.packageJsonRewrites,
      packageJsonNotices: result.packageJsonNotices,
    });
    return this.finishStep(
      'rename',
      `Step 2 of ${STEP_COUNT} (rename)`,
      `[ts-migrate][${path.basename(folder)}] Rename files from JS/JSX to TS/TSX`,
    );
  }

  private async stepMigrate(): Promise<number | undefined> {
    const { rootDir, folder, migrateOptions } = this.params;
    log.info(`
[Step 3 of ${STEP_COUNT}] Fixing TypeScript errors...
`);

    let outcome;
    try {
      outcome = await runMigrate({
        ...migrateOptions,
        rootDir,
        folder,
        typeScript: this.params.typeScript,
        typesPreflight: this.initSaidTypesPreflight ? false : migrateOptions.typesPreflight,
        holdTypesReport: true,
        collectSummary: true,
      });
    } catch (err) {
      // A plugin that throws must still reach the failure path: which step
      // stopped the run, what the working tree now holds, and the type
      // definition recommendations are exactly what a crash would swallow.
      log.error(errorMessage(err));
      if (err instanceof Error && err.stack) log.error(err.stack);
      return this.failStep('migrate', `Step 3 of ${STEP_COUNT} (migrate)`, 255);
    }

    this.typesReport = outcome.typesReport;
    this.migrateSummary = outcome.summary ?? null;
    if (outcome.exitCode !== 0) {
      return this.failStep('migrate', `Step 3 of ${STEP_COUNT} (migrate)`, outcome.exitCode);
    }

    return this.finishStep(
      'migrate',
      `Step 3 of ${STEP_COUNT} (migrate)`,
      `[ts-migrate][${path.basename(folder)}] Run TS Migrate`,
    );
  }

  /** 0 when the project compiles, 1 when it does not or the compiler is missing. */
  private async stepCheck(): Promise<number> {
    const { rootDir, folder } = this.params;
    log.info(`
[Step 4 of ${STEP_COUNT}] Checking for TS compilation errors (there shouldn't be any).
`);

    const command = this.resolveCheckCommand();
    if (!command) {
      this.steps.push({ name: 'check', status: 'failed', exitCode: 1, commit: null });
      return 1;
    }

    const configPath = `${folder}/tsconfig.json`;
    // --pretty is explicit because tsc switches to its terse format when its
    // stdout is not a terminal, and it is not echoed because the line is the
    // command worth re-running by hand.
    log.info(`${displayCommand(command)} -p ${configPath} --noEmit`);
    const { status, output } = await runCheck(command, configPath);
    if (status === 0) {
      this.steps.push({ name: 'check', status: 'ok', exitCode: 0, commit: null });
      return 0;
    }
    this.steps.push({ name: 'check', status: 'failed', exitCode: status, commit: null });

    log.info(`
---
The TypeScript check failed. What these errors mean:
`);
    this.explainCheckFailure(rootDir, folder, command, output);
    this.preserveTypesReport();
    return 1;
  }

  /** The argv of the compiler the check runs, or null when there is none to run. */
  private resolveCheckCommand(): string[] | null {
    // Prefer the requested tsc. Otherwise run the compiler the migrate step
    // resolved: a check run by a different compiler reports TS2578 for
    // suppressions the migration needed, and reignoring never converges.
    if (this.customTscPath) {
      if (isExecutable(this.customTscPath)) return [this.customTscPath];
      log.info(`No tsc found at ${this.customTscPath}; using the compiler the migration ran.`);
    }
    const migrationTsc = path.join(this.params.typeScript.packageDir, 'bin', 'tsc');
    if (!fs.existsSync(migrationTsc)) {
      log.info('Could not find the TypeScript compiler the migration used.');
      return null;
    }
    return [process.execPath, migrationTsc];
  }

  /**
   * Names the causes this run actually hit rather than every cause a run can
   * hit. Every test below matches an error code on its own rather than as part
   * of "error TS…": pretty output puts colour codes between the two words.
   */
  private explainCheckFailure(
    rootDir: string,
    folder: string,
    command: string[],
    output: string,
  ): void {
    // A generated declaration file the tsconfig does not match is in the
    // migration's program and no later one, so everything it declared is
    // missing here. migrate repairs the tsconfig itself; reaching this means
    // the repair was refused or the entry has since been removed.
    GENERATED_DECLARATIONS.forEach((generated) => {
      const generatedPath = path.join(rootDir, generated);
      if (!fs.existsSync(generatedPath)) return;
      // Anything but a confident "missing" is left alone: a probe that cannot
      // run says nothing about the tsconfig, and a wrong instruction here costs
      // more than a missing one.
      try {
        if (isIncludedByTsConfig(rootDir, generatedPath)) return;
      } catch {
        return;
      }
      log.info(`- ${folder}/tsconfig.json does not match ${generated}, so this check ran
  without it and every name it declares is reported undefined. Add
  "./${generated}" to "include" (or to "files") in that tsconfig and run the
  check again. Suppressing these instead would bury the declarations under a
  comment per use site:
    ${displayCommand(command)} -p ${folder}/tsconfig.json --noEmit
`);
    });

    if (output.includes('TS2578')) {
      log.info(`- TS2578 (unused '@ts-expect-error'): the compiler running this check disagrees
  with the one the migration used. Both default to the project's own typescript
  (the migration log names the copy it ran), so a skew is left only when a
  custom tsc path was set above, or when the project's compiler is outside the
  range ts-migrate supports and the bundled one was used instead.
  Align the two compilers first: re-run the check with the compiler the
  migration named, or migrate with --typescript pointing at the one this check
  ran. Reignoring under the skew does not converge, because it re-derives the
  same suppressions from the migration's compiler. Once they agree, and once
  tsconfig.json pins a "types" array, strip and re-add the suppressions with:
    ${reignoreCommand(this.params)}
`);
    }

    if (/\.d\.ts.{0,40}TS1[0-9][0-9][0-9]/.test(output)) {
      log.info(`- Syntax errors (TS1xxx) in generated or third-party .d.ts files: those files
  are outside the migration's control (the migration log lists them). Fix or
  regenerate them, or exclude them in tsconfig.json — re-running the migration
  will not change them.
`);
    }

    log.info(`- Type errors in migrated files: re-suppress them with
    ${reignoreCommand(this.params)}
`);
  }

  /**
   * Each pipeline step works on the previous step's writes, so a dry run cannot
   * reach the migration: nothing renamed a file for it to read. Saying where the
   * preview stops beats previewing a migration of files that do not exist.
   */
  private stopDryRun(): number {
    const { folder } = this.params;
    ['migrate', 'check'].forEach((name) => {
      this.steps.push({
        name: name as FullRunStep['name'],
        status: 'skipped',
        exitCode: null,
        commit: null,
      });
    });
    log.info(`
---
Dry run: the preview stops here. Steps 3 and 4 read the files Step 2 would have
renamed, and a dry run wrote none of them. Preview the migration itself once the
rename has really happened:
  ts-migrate migrate ${folder} --dryRun
`);
    return 0;
  }

  // -- git ------------------------------------------------------------------

  /**
   * The commit a step's writes went into. `sha` is null when there was nothing
   * to commit or commits are off; `failed` means git refused, which stops the
   * run: a rejecting pre-commit hook or an unset `user.email` otherwise leaves
   * the pipeline reporting success with the whole migration staged and
   * uncommitted.
   */
  private maybeCommit(subject: string): { sha: string | null; failed: false } | { failed: true; status: number } {
    if (!this.commit) return { sha: null, failed: false };
    const { rootDir } = this.params;
    // Scope the dirtiness check to the folder being committed; `git status`
    // alone reports the whole repository, and changes elsewhere would send an
    // empty commit to `git commit`, which fails.
    const status = git(rootDir, ['status', '--porcelain', '.']);
    if (status.status !== 0) return { failed: true, status: status.status };
    if (status.stdout.trim() === '') return { sha: null, failed: false };

    // The pathspec keeps the commit to the folder the run wrote, which is the
    // scope the check above already asks about. Without it `git commit` takes
    // the whole index, so anything staged elsewhere in the repository before
    // the run lands in a commit attributed to the migration, and the closing
    // checklist then offers that commit to .git-blame-ignore-revs.
    const steps: Array<{ args: string[] }> = [
      { args: ['add', '.'] },
      { args: ['commit', '-m', subject, '-m', 'Co-authored-by: ts-migrate <>', '--', '.'] },
      { args: ['rev-parse', 'HEAD'] },
    ];
    let head = '';
    for (let i = 0; i < steps.length; i += 1) {
      const result = git(rootDir, steps[i].args);
      // rev-parse writes the SHA to stdout; the other two are reported.
      if (i < 2) writeThrough(result.stdout);
      writeThrough(result.stderr);
      if (result.status !== 0) return { failed: true, status: result.status };
      head = result.stdout.trim();
    }

    this.commits.push({ sha: head, subject });
    return { sha: head, failed: false };
  }

  /**
   * Records a finished step, or ends the run when the commit it asked for was
   * refused. Every step that writes goes through here.
   */
  private finishStep(name: FullRunStep['name'], label: string, subject: string): number | undefined {
    const commit = this.maybeCommit(subject);
    if (commit.failed) {
      return this.endRun(
        name,
        `${label} wrote its changes, but git refused to commit them (git exited ${commit.status})`,
        commit.status,
      );
    }
    this.steps.push({ name, status: 'ok', exitCode: 0, commit: commit.sha });
    return undefined;
  }

  /**
   * The mechanical rewrite commits are exactly what .git-blame-ignore-revs is
   * for. Writing the file is opt-in: on squash or rebase merge workflows these
   * SHAs never reach the main branch, and dangling SHAs in the file break
   * git blame repo-wide for fresh clones.
   */
  private writeBlameIgnoreRevs(): boolean {
    if (!this.params.blameIgnoreRevs || this.commits.length === 0) return false;
    const root = git(this.params.rootDir, ['rev-parse', '--show-toplevel']);
    if (root.status !== 0) return false;
    try {
      fs.appendFileSync(
        path.join(root.stdout.trim(), '.git-blame-ignore-revs'),
        `# ts-migrate ${path.basename(this.params.folder)}\n${this.commits
          .map(({ sha }) => sha)
          .join('\n')}\n`,
      );
      return true;
    } catch (err) {
      log.warn(`Could not write .git-blame-ignore-revs: ${errorMessage(err)}`);
      return false;
    }
  }

  // -- reporting ------------------------------------------------------------

  private showTypesReport(): void {
    if (this.typesReportShown || !this.typesReport) return;
    this.typesReportShown = true;
    log.info('');
    log.info(this.typesReport);
  }

  /**
   * On a failure the recommendations are the only thing left to act on, and the
   * output they sit under can be long, so they outlive the run in a file too.
   */
  private preserveTypesReport(): void {
    if (!this.typesReport) return;
    const alreadyShown = this.typesReportShown;
    this.showTypesReport();
    if (alreadyShown) return;
    let reportFile;
    try {
      reportFile = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-types-')),
        'types-report.txt',
      );
      fs.writeFileSync(reportFile, `${this.typesReport}\n`);
    } catch (err) {
      log.warn(`Could not keep the type definition recommendations: ${errorMessage(err)}`);
      return;
    }
    log.info(`
The recommendations above are also in ${reportFile}.`);
  }

  /**
   * A failing step ends the run with a statement of which step stopped it, what
   * the working tree holds, and what the migration recommended, none of which
   * the step's own error says.
   */
  private failStep(name: FullRunStep['name'], label: string, status: number): number {
    return this.endRun(
      name,
      `${label} failed (exit ${reportedExitCode(status)})`,
      status,
    );
  }

  /** `headline` states what went wrong; everything after it is the same either way. */
  private endRun(name: FullRunStep['name'], headline: string, status: number): number {
    this.steps.push({ name, status: 'failed', exitCode: status, commit: null });
    log.info(`
---
${headline}; the remaining steps did not run.`);
    this.preserveTypesReport();
    log.info(`
This run's partial result is in the working tree; nothing was rolled back.`);
    if (this.inGitWorkTree) {
      log.info(`\`git -C "${this.params.folder}" status\` shows what it wrote, and
\`git -C "${this.params.folder}" checkout .\` reverts the tracked files.`);
    }
    return status;
  }

  /** Each item is numbered where it lands, so a dropped one leaves no gap. */
  private closingChecklist(): void {
    const wroteIgnoreRevs = this.writeBlameIgnoreRevs();
    const tooling = this.toolingItems();
    // A run outside a git repository has already said it cannot commit, so
    // pointing its result at commits and at `git push` names steps the user
    // has no way to take.
    const items: Array<(position: number) => void> = [
      (position) =>
        log.info(
          this.inGitWorkTree
            ? `${position}. Sanity check the commits (or, with --commit=false, the working tree).`
            : `${position}. Sanity check the working tree.`,
        ),
      ...tooling.map((item) => (position: number) => log.info(`${position}. ${item}`)),
    ];
    if (this.commits.length > 0) {
      items.push((position) => this.blameItem(position, wroteIgnoreRevs));
    }
    if (this.inGitWorkTree) {
      items.push((position) =>
        log.info(`${position}. Push your changes with \`git push\` and open a PR!\n`),
      );
    }

    // The claim about the tooling belongs to the tooling items: without them,
    // the git steps are the whole list and the project's tooling is fine.
    const heading =
      tooling.length > 0
        ? "Remaining cleanup — the rest of your tooling doesn't know about the rename yet:"
        : 'Remaining cleanup:';
    log.info(`
${heading}
`);
    items.forEach((print, index) => print(index + 1));
  }

  /**
   * The project plumbing the migration deliberately does not touch, minus what
   * this project already has: advice a project has already taken reads as
   * advice the run never checked, and takes the items beside it down with it.
   */
  private toolingItems(): string[] {
    const { rootDir } = this.params;
    const items: string[] = [];
    if (!hasTypeScriptBuild(rootDir)) {
      items.push('Add a build step (tsc) or a TS-aware runner (ts-node, tsx).');
    }
    const entryPoints = this.renamedEntryPointFields();
    if (entryPoints.length > 0) {
      items.push(`Point the package.json entry points the rename listed (${entryPoints.join(', ')})
   at build output. They address your package from the outside, so pointing
   them at the renamed source would leave it unloadable rather than merely
   stale; script paths and test globs were repointed for you.`);
    }
    if (eslintTypeScriptSupport(rootDir) === 'javascript-only') {
      items.push('Teach ESLint about TypeScript (the @typescript-eslint parser and plugin).');
    }
    return items;
  }

  /**
   * The entry point fields the rename left pointing at a file it renamed, as
   * the field names alone: the rename step listed each one with its value and
   * its new target, and one field named twice is still one thing to go fix.
   */
  private renamedEntryPointFields(): string[] {
    const notices = this.renameSummary?.packageJsonNotices ?? [];
    // The key addresses the value inside the field, as in `files[0]`.
    const fields = notices.map(({ key }) => `"${key.split(/[.[]/)[0]}"`);
    return [...new Set(fields)];
  }

  private blameItem(position: number, wroteIgnoreRevs: boolean): void {
    log.info(`${position}. Keep git blame useful. This run created mechanical rewrite commits:`);
    this.commits.forEach(({ sha }) => {
      const shown = git(this.params.rootDir, [
        '--no-pager',
        'show',
        '-s',
        '--format=     %H  %s',
        sha,
      ]);
      writeThrough(shown.stdout);
    });
    if (wroteIgnoreRevs) {
      log.info(`   Their SHAs were appended to .git-blame-ignore-revs at the repository root.
   Review that file and commit it together with your cleanup changes.`);
    } else {
      log.info(`   If your team merges PRs with merge commits, add those full SHAs to a
   .git-blame-ignore-revs file at the repository root; re-running with
   --blameIgnoreRevs writes it for you. If your team squash-merges or
   rebases, these SHAs will not exist on the main branch: add the SHA of the
   merged commit to the file after the merge instead.`);
    }
    log.info(`   Once the file is committed, \`git config blame.ignoreRevsFile .git-blame-ignore-revs\`
   makes local git blame skip those commits; github.com applies the root file
   automatically.`);
  }

  private outcome(exitCode: number): FullOutcome {
    const reached = new Set(this.steps.map((step) => step.name));
    const allSteps: FullRunStep[] = [...this.steps];
    (['init', 'rename', 'migrate', 'check'] as const).forEach((name) => {
      if (!reached.has(name)) {
        allSteps.push({ name, status: 'not-reached', exitCode: null, commit: null });
      }
    });
    return {
      exitCode,
      summary: {
        command: 'full',
        tsMigrateVersion: packageVersion(),
        rootDir: this.params.rootDir,
        exitCode,
        dryRun: this.params.dryRun,
        steps: allSteps,
        commits: this.commits,
        rename: this.renameSummary,
        migrate: this.migrateSummary,
      },
    };
  }
}

/**
 * The check as a line worth re-running by hand. The interpreter is spawned by
 * its absolute path, so the check cannot land on a different Node than the run
 * that chose the compiler, but it is shown as `node`: the absolute path is this
 * process's own and says nothing the reader needs.
 */
function displayCommand(command: string[]): string {
  return command.map((part) => (part === process.execPath ? 'node' : part)).join(' ');
}

/**
 * The exit code the caller will see. A step reporting a negative code (migrate
 * uses -1 for an empty migration set) leaves the process exiting with its low
 * byte, and a failure message naming a number nobody can observe helps nobody.
 */
function reportedExitCode(status: number): number {
  return ((status % 256) + 256) % 256;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * The version a custom tsc reports. `tsc -v` prints one line, "Version 5.7.3";
 * a wrapper that prints anything else leaves the version unknown, and an unknown
 * version is not compared against the migration's.
 */
function readTscVersion(tscPath: string): string | undefined {
  const result = spawnSync(tscPath, ['-v'], { encoding: 'utf-8' });
  if (result.status !== 0) return undefined;
  const match = /^Version ([0-9]\S*)$/m.exec(result.stdout ?? '');
  return match?.[1];
}

/**
 * Runs the compile check, showing its output as it arrives and keeping a copy,
 * so the explanation below names the causes this run hit. tsc's stderr is folded
 * into the same stream, as a terminal would show it.
 */
function runCheck(
  command: string[],
  configPath: string,
): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      command[0],
      [...command.slice(1), '-p', configPath, '--noEmit', '--pretty'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    const writer = new LineWriter();
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      writer.write(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      writer.flush();
      log.error(`Could not run the TypeScript check: ${errorMessage(err)}`);
      resolve({ status: 1, output });
    });
    child.on('close', (code) => {
      writer.flush();
      resolve({ status: code ?? 1, output });
    });
  });
}
