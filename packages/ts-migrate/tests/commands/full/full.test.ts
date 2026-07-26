import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import full, { FullParams, Prompter } from '../../../commands/full';
import { TypeScriptDecision } from '../../../utils/resolveTypeScript';
import { deleteDir, hashDir, transcriptLines } from '@obiemunoz/ts-migrate-test-utils';

/**
 * The pipeline driven in process, the way a caller drives it, rather than
 * through a shell. Everything the run does for real is real here: init writes a
 * tsconfig, rename renames on disk, migrate runs a plugin over the result, and
 * git makes actual commits. Only the compile check is a stub, because the point
 * of a test is to choose what it reports.
 */
jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { collectingUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return collectingUpdatableLog();
});

/**
 * Outside the repository rather than in tests/tmp: this suite asks git what it
 * thinks of the project folder, and a folder inside a checkout is always in a
 * work tree, so the case of a project that is in no repository at all could not
 * be reached from there.
 */
const createDir = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-full-'));

let rootDir: string;
/** The typescript package the check step resolves its compiler from. */
let compilerDir: string;

beforeEach(() => {
  transcriptLines.length = 0;
  rootDir = createDir();
  // Outside rootDir, so the migration never sees it as part of the project.
  compilerDir = createDir();
  writeCheckCompiler('process.exit(0);\n');
});

afterEach(() => {
  deleteDir(rootDir);
  deleteDir(compilerDir);
});

/** The `bin/tsc` the check step spawns, with a body the test chooses. */
function writeCheckCompiler(body: string): void {
  const binDir = path.join(compilerDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(compilerDir, 'package.json'), '{"name":"typescript","version":"5.7.3"}');
  fs.writeFileSync(path.join(binDir, 'tsc'), body);
}

/** A compile check that reports the given diagnostics and fails. */
function writeFailingCheck(diagnostics: string): void {
  writeCheckCompiler(`console.log(${JSON.stringify(diagnostics)});\nprocess.exit(2);\n`);
}

const decision = (): TypeScriptDecision => ({
  packageDir: compilerDir,
  version: '5.7.3',
  source: 'project',
});

function writeProject(files: Record<string, string>): void {
  Object.entries(files).forEach(([file, text]) => {
    const filePath = path.join(rootDir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  });
}

/** A project small enough that a real migration of it costs a second. */
function writeSmallProject(): void {
  writeProject({
    'package.json': '{ "name": "demo" }\n',
    'src/index.js': 'function greet(name) {\n  return `hi ${name}`;\n}\nmodule.exports = { greet };\n',
  });
}

const git = (...args: string[]) => execFileSync('git', ['-C', rootDir, ...args], { encoding: 'utf-8' });

function initGitRepo(): void {
  git('init', '-q');
  git('config', 'user.email', 'ts-migrate@example.com');
  git('config', 'user.name', 'ts-migrate');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
}

/** Answers the run's prompts in order; a shorter list means the input ran out. */
function scriptedPrompter(answers: string[]): Prompter & { asked: string[] } {
  const asked: string[] = [];
  let next = 0;
  return {
    asked,
    ask: async (question: string) => {
      asked.push(question);
      return next < answers.length ? answers[next++] : null;
    },
    close: () => {},
  };
}

function run(overrides: Partial<FullParams> = {}) {
  return full({
    rootDir,
    folder: rootDir,
    typeScript: decision(),
    yes: true,
    commit: false,
    blameIgnoreRevs: false,
    dryRun: false,
    renameOptions: {},
    // One plugin rather than the pipeline: this suite is about the sequence,
    // and the pipeline has its own tests.
    migrateOptions: { plugins: { plugin: 'ts-ignore' }, collectSummary: true },
    ...overrides,
  });
}

const output = () => transcriptLines.join('\n');

describe('the full pipeline', () => {
  it('runs init, rename, migrate and the check in order', async () => {
    writeSmallProject();

    const { exitCode, summary } = await run();

    expect(exitCode).toBe(0);
    expect(summary.steps.map((step) => [step.name, step.status])).toEqual([
      ['init', 'ok'],
      ['rename', 'ok'],
      ['migrate', 'ok'],
      ['check', 'ok'],
    ]);
    expect(fs.existsSync(path.join(rootDir, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'src/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'src/index.js'))).toBe(false);
    expect(output()).toContain('All done! Your project compiles with TypeScript now.');
  }, 120000);

  it('nests the rename and migrate summaries instead of overwriting one with the other', async () => {
    writeSmallProject();

    const { summary } = await run();

    expect(summary.command).toBe('full');
    expect(summary.rename?.renamedFiles).toEqual([{ from: 'src/index.js', to: 'src/index.ts' }]);
    expect(summary.migrate?.changedFiles).toEqual(['src/index.ts']);
  }, 120000);

  it('leaves an existing tsconfig.json to the migrate step to report on', async () => {
    writeSmallProject();
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "include": ["src"] }\n');

    const { summary } = await run();

    expect(summary.steps.find((step) => step.name === 'init')?.status).toBe('skipped');
  }, 120000);
});

describe('the full pipeline commit step', () => {
  it('commits each step and reports the SHAs in the summary', async () => {
    writeSmallProject();
    initGitRepo();

    const { exitCode, summary } = await run({ commit: true });

    expect(exitCode).toBe(0);
    expect(summary.commits.map((commit) => commit.subject)).toEqual([
      `[ts-migrate][${path.basename(rootDir)}] Init tsconfig.json file`,
      `[ts-migrate][${path.basename(rootDir)}] Rename files from JS/JSX to TS/TSX`,
      `[ts-migrate][${path.basename(rootDir)}] Run TS Migrate`,
    ]);
    summary.commits.forEach(({ sha }) => expect(sha).toMatch(/^[0-9a-f]{40}$/));
    // Every step that wrote something names the commit it went into.
    expect(
      summary.steps.filter((step) => step.commit !== null).map((step) => step.name),
    ).toEqual(['init', 'rename', 'migrate']);
  }, 120000);

  it('keeps the .eslintrc it writes for the migrate step out of every commit', async () => {
    writeSmallProject();
    initGitRepo();

    await run({ commit: true });

    const committed = git('log', '--format=', '--name-only');
    expect(committed).toContain('tsconfig.json');
    expect(committed).not.toContain('.eslintrc');
    expect(fs.existsSync(path.join(rootDir, '.eslintrc'))).toBe(false);
  }, 120000);

  it('appends the SHAs to .git-blame-ignore-revs only when asked', async () => {
    writeSmallProject();
    initGitRepo();

    const { summary } = await run({ commit: true, blameIgnoreRevs: true });

    const ignoreRevs = fs.readFileSync(path.join(rootDir, '.git-blame-ignore-revs'), 'utf-8');
    summary.commits.forEach(({ sha }) => expect(ignoreRevs).toContain(sha));
  }, 120000);
});

describe('the full pipeline git tree preflight', () => {
  beforeEach(() => {
    writeSmallProject();
  });

  it('names a folder outside a git repository and runs without commits', async () => {
    const { summary } = await run({ commit: true });

    expect(output()).toContain('is not in a git repository');
    expect(summary.commits).toEqual([]);
  }, 120000);

  it('says nothing about a clean tree', async () => {
    initGitRepo();

    await run({ commit: true });

    expect(output()).not.toContain('Uncommitted changes');
  }, 120000);

  it('lists what a committing run would sweep into its own commits', async () => {
    initGitRepo();
    fs.writeFileSync(path.join(rootDir, 'wip.js'), 'module.exports = 1;\n');

    await run({ commit: true });

    expect(output()).toContain('Uncommitted changes in');
    expect(output()).toContain('?? wip.js');
    expect(output()).toContain('git add .');
    expect(output()).toContain('git stash -u');
  }, 120000);

  it('warns under --commit=false, where nothing holds a copy of an untracked file', async () => {
    initGitRepo();
    fs.writeFileSync(path.join(rootDir, 'wip.js'), 'module.exports = 1;\n');

    await run({ commit: false });

    expect(output()).toContain('?? wip.js');
    expect(output()).toContain('no committed copy to recover it from');
    expect(output()).not.toContain('git add .');
  }, 120000);

  it('caps the list and counts the rest', async () => {
    initGitRepo();
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(path.join(rootDir, `wip${i}.txt`), '');
    }

    await run();

    expect(output()).toContain('Uncommitted changes in');
    expect(output()).toContain('(12)');
    expect(output()).toContain('... and 2 more');
  }, 120000);

  it('warns and continues under --yes', async () => {
    initGitRepo();
    fs.writeFileSync(path.join(rootDir, 'wip.js'), 'module.exports = 1;\n');

    const { exitCode } = await run({ yes: true });

    expect(exitCode).toBe(0);
    expect(output()).toContain('--yes was passed, so the run continues.');
  }, 120000);
});

describe('the full pipeline prompts', () => {
  beforeEach(() => {
    writeSmallProject();
  });

  it('stops before Step 1 when the first answer is not yes', async () => {
    const prompter = scriptedPrompter(['n']);

    const { exitCode } = await run({ yes: false, prompter });

    expect(exitCode).toBe(0);
    expect(output()).toContain('See you later.');
    expect(output()).not.toContain('[Step 1 of 4]');
    expect(prompter.asked[0]).toBe('Continue? (y/N) ');
  }, 120000);

  it('exits nonzero when there is no input and no --yes', async () => {
    const { exitCode } = await run({ yes: false, prompter: scriptedPrompter([]) });

    expect(exitCode).toBe(1);
    expect(output()).toContain('re-run with --yes to skip the prompts');
    expect(output()).not.toContain('[Step 1 of 4]');
  }, 120000);

  it('asks nothing under --yes', async () => {
    const prompter = scriptedPrompter(['y', '']);

    await run({ yes: true, prompter });

    expect(prompter.asked).toEqual([]);
  }, 120000);

  it('says which compiler the check will run when no custom path is given', async () => {
    await run({ yes: false, prompter: scriptedPrompter(['y', '']) });

    expect(output()).toContain('The check will run the same compiler the migration used.');
    expect(output()).not.toContain('Continue anyway?');
  }, 120000);
});

describe('the full pipeline compiler skew preflight', () => {
  /** An executable tsc that reports the given version and compiles nothing. */
  function writeCustomTsc(version: string): string {
    const tscPath = path.join(rootDir, `tsc-${version}`);
    fs.writeFileSync(
      tscPath,
      `#!/usr/bin/env bash\nif [ "$1" = "-v" ]; then echo "Version ${version}"; fi\nexit 0\n`,
    );
    fs.chmodSync(tscPath, 0o755);
    return tscPath;
  }

  beforeEach(() => {
    writeSmallProject();
  });

  it('stops before Step 1 when the custom tsc cannot check what the migration writes', async () => {
    const prompter = scriptedPrompter(['y', writeCustomTsc('5.5.4'), 'n']);

    const { exitCode } = await run({ yes: false, prompter });

    expect(exitCode).toBe(1);
    expect(output()).toContain('TS2578');
    expect(output()).toContain('Stopping before Step 1');
    expect(output()).not.toContain('[Step 1 of 4]');
  }, 120000);

  it('runs the migration anyway when the skew is confirmed', async () => {
    const prompter = scriptedPrompter(['y', writeCustomTsc('5.5.4'), 'y']);

    await run({ yes: false, prompter });

    expect(output()).toContain('TS2578');
    expect(output()).toContain('[Step 1 of 4]');
  }, 120000);

  it('does not ask about a patch difference', async () => {
    const prompter = scriptedPrompter(['y', writeCustomTsc('5.7.2')]);

    await run({ yes: false, prompter });

    expect(output()).not.toContain('Continue anyway?');
    expect(output()).toContain('[Step 1 of 4]');
  }, 120000);

  it('does not guess when the custom tsc reports no version', async () => {
    const wrapper = path.join(rootDir, 'tsc-wrapper');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(wrapper, 0o755);

    await run({ yes: false, prompter: scriptedPrompter(['y', wrapper]) });

    expect(output()).not.toContain('Continue anyway?');
    expect(output()).toContain('[Step 1 of 4]');
  }, 120000);
});

describe('a full pipeline step that fails', () => {
  it('names the step, exits with its code, and says where the partial result is', async () => {
    // A tsconfig whose include matches nothing makes the rename step fail.
    writeProject({
      'package.json': '{ "name": "demo" }\n',
      'src/index.js': 'module.exports = 1;\n',
      'tsconfig.json': '{ "include": ["nothing/**/*"] }\n',
    });

    const { exitCode, summary } = await run();

    expect(exitCode).toBe(255);
    expect(output()).toContain('Step 2 of 4 (rename) failed (exit 255); the remaining steps did not run.');
    expect(output()).toContain("This run's partial result is in the working tree");
    expect(summary.steps.map((step) => [step.name, step.status])).toEqual([
      ['init', 'skipped'],
      ['rename', 'failed'],
      ['migrate', 'not-reached'],
      ['check', 'not-reached'],
    ]);
  }, 120000);

  // Under the shell script `set -e` stopped the run here. Carrying on would
  // report success with the whole migration staged and nothing committed.
  it('stops when git refuses the commit a step asked for', async () => {
    writeSmallProject();
    initGitRepo();
    const hook = path.join(rootDir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);

    const { exitCode, summary } = await run({ commit: true });

    expect(exitCode).not.toBe(0);
    expect(output()).toContain('git refused to commit them');
    expect(output()).not.toContain('All done!');
    expect(summary.commits).toEqual([]);
    expect(summary.steps.map((step) => step.status)).toEqual([
      'failed',
      'not-reached',
      'not-reached',
      'not-reached',
    ]);
    // Only the fixture commit, so the run claimed nothing it did not do.
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
  }, 120000);

  it('names the git commands that show and revert the partial result', async () => {
    writeProject({
      'package.json': '{ "name": "demo" }\n',
      'src/index.js': 'module.exports = 1;\n',
      'tsconfig.json': '{ "include": ["nothing/**/*"] }\n',
    });
    initGitRepo();

    await run();

    expect(output()).toContain(`git -C "${rootDir}" checkout .`);
  }, 120000);
});

describe('a full pipeline check that fails', () => {
  const tsError = (code: string, file = 'src/index.ts') =>
    `${file}(3,10): error ${code}: something is wrong.`;

  beforeEach(() => {
    writeSmallProject();
  });

  it('explains only the causes the compiler output shows', async () => {
    writeFailingCheck(tsError('TS2339'));

    const { exitCode, summary } = await run();

    expect(exitCode).toBe(1);
    expect(output()).toContain('The TypeScript check failed');
    expect(output()).toContain('ts-migrate reignore');
    expect(output()).not.toContain("TS2578 (unused '@ts-expect-error')");
    expect(output()).not.toContain('Syntax errors (TS1xxx)');
    expect(summary.steps.find((step) => step.name === 'check')?.status).toBe('failed');
  }, 120000);

  it('explains a compiler skew when the output reports TS2578', async () => {
    writeFailingCheck(tsError('TS2578'));

    await run();

    expect(output()).toContain("TS2578 (unused '@ts-expect-error')");
    expect(output()).not.toContain('Syntax errors (TS1xxx)');
  }, 120000);

  it('explains a broken declaration file when one is in the output', async () => {
    writeFailingCheck(tsError('TS1005', 'node_modules/x/index.d.ts'));

    await run();

    expect(output()).toContain('Syntax errors (TS1xxx)');
    expect(output()).not.toContain("TS2578 (unused '@ts-expect-error')");
  }, 120000);

  it('shows the compiler output as well as the explanation', async () => {
    writeFailingCheck(tsError('TS2339'));

    await run();

    expect(output()).toContain('src/index.ts(3,10): error TS2339');
  }, 120000);

  it('repeats the flags the run was scoped with in the reignore hint', async () => {
    writeFailingCheck(tsError('TS2339'));

    await run({
      folder: 'my-app',
      renameOptions: { sources: 'src/**/*' },
      migrateOptions: {
        plugins: { plugin: 'ts-ignore', projectEslint: false },
        sources: 'src/**/*',
        collectSummary: true,
      },
      typeScriptOverride: '/opt/ts',
    });

    expect(output()).toContain(
      'ts-migrate reignore "my-app" --sources "src/**/*" --projectEslint=false --typescript "/opt/ts"',
    );
  }, 120000);
});

describe('the .eslintrc the full pipeline writes for the migrate step', () => {
  /** The migrate step is the only one that runs ESLint, and it needs a config to find. */
  it.each([
    ['.eslintrc', '{}\n'],
    ['.eslintrc.json', '{}\n'],
    ['eslint.config.js', 'module.exports = [];\n'],
  ])('is not written when the project already has %s', async (file, contents) => {
    writeSmallProject();
    fs.writeFileSync(path.join(rootDir, file), contents);

    await run();

    // The run neither wrote a config of its own nor deleted the project's.
    expect(fs.readFileSync(path.join(rootDir, file), 'utf-8')).toBe(contents);
    expect(fs.existsSync(path.join(rootDir, '.eslintrc'))).toBe(file === '.eslintrc');
  }, 120000);

  it('is not written when package.json carries the config', async () => {
    writeProject({
      'package.json': '{ "name": "demo", "eslintConfig": { "rules": {} } }\n',
      'src/index.js': 'module.exports = 1;\n',
    });

    await run();

    expect(fs.existsSync(path.join(rootDir, '.eslintrc'))).toBe(false);
  }, 120000);
});

describe('the full pipeline type definition recommendations', () => {
  /** A project whose declared test runner has no @types installed. */
  function writeProjectMissingTypes(): void {
    writeProject({
      'package.json': '{ "name": "demo", "devDependencies": { "jest": "^29.0.0" } }\n',
      'node_modules/jest/package.json': '{ "name": "jest", "version": "29.0.0" }\n',
      'src/a.test.js': 'describe("thing", () => {\n  it("works", () => {});\n});\n',
    });
  }

  // The default pipeline rather than one plugin: the detector that produces the
  // report is part of it.
  const runWholePipeline = (overrides: Partial<FullParams> = {}) =>
    run({ migrateOptions: { plugins: {}, collectSummary: true }, ...overrides });

  it('holds the report back to the end of a successful run and prints it once', async () => {
    writeProjectMissingTypes();

    const { exitCode } = await runWholePipeline();

    expect(exitCode).toBe(0);
    expect(output().split('Type definition recommendations:').length - 1).toBe(1);
    // Printed after the closing line, where a long run's output cannot bury it.
    expect(output().indexOf('All done!')).toBeLessThan(
      output().indexOf('Type definition recommendations:'),
    );
    expect(output()).not.toContain('The recommendations above are also in');
  }, 180000);

  it('keeps the report in a file when the check fails, and still prints it once', async () => {
    writeProjectMissingTypes();
    writeFailingCheck('src/a.test.ts(1,1): error TS2339: something is wrong.');

    const { exitCode } = await runWholePipeline();

    expect(exitCode).toBe(1);
    expect(output().split('Type definition recommendations:').length - 1).toBe(1);

    const reportPath = /also in (\S+)\.$/m.exec(output())?.[1];
    expect(reportPath).toBeTruthy();
    expect(fs.readFileSync(reportPath!, 'utf-8')).toContain('@types/jest');
    fs.rmSync(path.dirname(reportPath!), { recursive: true, force: true });
  }, 180000);
});

describe('a full pipeline dry run', () => {
  it('previews the rename and stops before the migration, writing nothing', async () => {
    writeSmallProject();
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "include": ["src"] }\n');
    const before = hashDir(rootDir);

    const { exitCode, summary } = await run({ dryRun: true });

    expect(exitCode).toBe(0);
    expect(hashDir(rootDir)).toBe(before);
    expect(output()).toContain('src/index.js -> src/index.ts');
    expect(output()).toContain('Dry run: the preview stops here.');
    expect(summary.dryRun).toBe(true);
    expect(summary.steps.map((step) => step.status)).toEqual([
      'skipped',
      'ok',
      'skipped',
      'skipped',
    ]);
  }, 120000);

  it('makes no commits even with commits enabled', async () => {
    writeSmallProject();
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{ "include": ["src"] }\n');
    initGitRepo();

    const { summary } = await run({ dryRun: true, commit: true });

    expect(summary.commits).toEqual([]);
    expect(git('log', '--format=%s').trim()).toBe('fixture');
  }, 120000);

  it('says why it cannot preview the rename of a project with no tsconfig', async () => {
    writeSmallProject();
    const before = hashDir(rootDir);

    const { exitCode } = await run({ dryRun: true });

    expect(exitCode).toBe(0);
    expect(hashDir(rootDir)).toBe(before);
    expect(output()).toContain('there is no mapping to preview');
  }, 120000);
});
