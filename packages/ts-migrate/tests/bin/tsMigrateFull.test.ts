import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

const packageRoot = path.resolve(__dirname, '..', '..');

/**
 * The script under test with the layout it ships in: a bin/ next to a build/
 * holding the CLI and the compiled utils it probes the compiler with. Both are
 * stubs, so a run reaches the end of the pipeline without a migration.
 */
let installDir: string;
let projectDir: string;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-full-'));

  fs.mkdirSync(path.join(installDir, 'bin'));
  fs.copyFileSync(
    path.join(packageRoot, 'bin', 'ts-migrate-full.sh'),
    path.join(installDir, 'bin', 'ts-migrate-full.sh'),
  );

  fs.mkdirSync(path.join(installDir, 'build', 'utils'), { recursive: true });
  fs.writeFileSync(
    path.join(installDir, 'build', 'cli.js'),
    `console.log('[stub cli]', process.argv.slice(2).join(' '));\n`,
  );
  fs.writeFileSync(
    path.join(installDir, 'build', 'utils', 'resolveTypeScript.js'),
    ts.transpileModule(
      fs.readFileSync(path.join(packageRoot, 'utils', 'resolveTypeScript.ts'), 'utf-8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2019,
          esModuleInterop: true,
        },
      },
    ).outputText,
  );

  projectDir = path.join(installDir, 'project');
  fs.mkdirSync(path.join(projectDir, 'node_modules', 'typescript'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'node_modules', 'typescript', 'package.json'),
    JSON.stringify({ name: 'typescript', version: '5.7.3' }),
  );
});

afterEach(() => {
  fs.rmSync(installDir, { recursive: true, force: true });
});

/** An executable tsc that reports the given version and compiles nothing. */
function writeTsc(version: string): string {
  const tscPath = path.join(installDir, `tsc-${version}`);
  fs.writeFileSync(
    tscPath,
    `#!/usr/bin/env bash\nif [ "$1" = "-v" ]; then echo "Version ${version}"; fi\nexit 0\n`,
  );
  fs.chmodSync(tscPath, 0o755);
  return tscPath;
}

/** Answers the prompts in order. --no-commit by default, so a run cannot reach `git commit`. */
function runFull(answers: string[], args: string[] = ['--no-commit']): {
  status: number;
  output: string;
} {
  try {
    const output = execFileSync(
      'bash',
      [path.join(installDir, 'bin', 'ts-migrate-full.sh'), projectDir, ...args],
      { input: `${answers.join('\n')}\n`, encoding: 'utf-8', stdio: 'pipe' },
    );
    return { status: 0, output };
  } catch (err: any) {
    return { status: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', projectDir, ...args], { stdio: 'ignore' });

/** A git repository at the project, so a run without --no-commit can commit. */
function initGitRepo(): void {
  git('init', '-q');
  git('config', 'user.email', 'ts-migrate@example.com');
  git('config', 'user.name', 'ts-migrate');
  git('config', 'commit.gpgsign', 'false');
}

/** Commits the fixture, so a later status reports only what a test added. */
function commitFixture(): void {
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
}

/**
 * The compiler the check falls back to when no custom tsc is set, which is the
 * path every non-interactive run takes.
 */
function writeMigrationTsc(): void {
  const binDir = path.join(projectDir, 'node_modules', 'typescript', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'tsc'), 'process.exit(0);\n');
}

describe('the ts-migrate-full compiler preflight', () => {
  it('stops before Step 1 when the custom tsc cannot check what the migration writes', () => {
    const { status, output } = runFull(['y', writeTsc('5.5.4'), 'n']);

    expect(output).toContain('TypeScript 5.5.4');
    expect(output).toContain('TypeScript 5.7.3');
    expect(output).toContain(path.join(projectDir, 'node_modules', 'typescript'));
    expect(output).toContain('TS2578');
    expect(output).toContain('Stopping before Step 1');
    expect(output).not.toContain('Step 1 of 4');
    expect(status).toBe(1);
  });

  it('runs the migration anyway when the skew is confirmed', () => {
    const { output } = runFull(['y', writeTsc('5.5.4'), 'y']);

    expect(output).toContain('TS2578');
    expect(output).toContain('Step 1 of 4');
  });

  it('does not ask about a patch difference', () => {
    const { output } = runFull(['y', writeTsc('5.7.2')]);

    expect(output).not.toContain('Continue anyway?');
    expect(output).toContain('Step 1 of 4');
  });

  it('does not guess when the custom tsc reports no version', () => {
    const wrapper = path.join(installDir, 'tsc-wrapper');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(wrapper, 0o755);

    const { output } = runFull(['y', wrapper]);

    expect(output).not.toContain('Continue anyway?');
    expect(output).toContain('Step 1 of 4');
  });

  it('has nothing to compare when the check runs the migration compiler', () => {
    const { output } = runFull(['y', '']);

    expect(output).toContain('The check will run the same compiler the migration used.');
    expect(output).not.toContain('Continue anyway?');
    expect(output).toContain('Step 1 of 4');
  });
});

describe('the ts-migrate-full type package preflight', () => {
  it('is left to the migrate step for a folder that already has a tsconfig', () => {
    fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), '{}\n');

    const { status, output } = runFull(['y', writeTsc('5.7.2')]);

    expect(status).toBe(0);
    expect(output).not.toContain('[stub cli] init');
    expect(output).toContain('[stub cli] migrate');
    expect(output).not.toContain('--no-typesPreflight');
  });

  it('is said once when Step 1 writes the tsconfig itself', () => {
    const { status, output } = runFull(['y', writeTsc('5.7.2')]);

    expect(status).toBe(0);
    expect(output).toContain('[stub cli] init');
    expect(output).toContain('--no-typesPreflight');
  });
});

describe('the ts-migrate-full commit step', () => {
  it('commits without printing a directory of its own between the steps', () => {
    initGitRepo();

    const { status, output } = runFull(['y', writeTsc('5.7.2')], []);

    expect(status).toBe(0);
    expect(output).toContain('[ts-migrate][project] Init tsconfig.json file');
    expect(output).toContain('This run created mechanical rewrite commits');
    const bareDirectories = output.split('\n').filter((line) => /^\/\S*$/.test(line.trim()));
    expect(bareDirectories).toEqual([]);
  });
});

describe('the ts-migrate-full git tree preflight', () => {
  it('names a folder outside a git repository instead of failing every commit', () => {
    const { status, output } = runFull(['y', writeTsc('5.7.2')], []);

    expect(status).toBe(0);
    expect(output).toContain('is not in a git repository');
    expect(output.indexOf('is not in a git repository')).toBeLessThan(
      output.indexOf('Step 1 of 4'),
    );
  });

  describe('in a git repository', () => {
    beforeEach(() => {
      writeMigrationTsc();
      initGitRepo();
      commitFixture();
    });

    it('says nothing about a clean tree', () => {
      const { status, output } = runFull(['y', writeTsc('5.7.2')], []);

      expect(status).toBe(0);
      expect(output).not.toContain('Uncommitted changes');
    });

    it('lists what the run would sweep into its own commits', () => {
      fs.writeFileSync(path.join(projectDir, 'wip.js'), 'module.exports = 1;\n');

      const { status, output } = runFull(['y', writeTsc('5.7.2')], []);

      expect(status).toBe(0);
      expect(output).toContain('Uncommitted changes in');
      expect(output).toContain('?? wip.js');
      expect(output).toContain('git add .');
      expect(output).toContain('git stash -u');
      expect(output.indexOf('Uncommitted changes in')).toBeLessThan(
        output.indexOf('Step 1 of 4'),
      );
    });

    it('reports every path git add would stage, capped with a count', () => {
      for (let i = 0; i < 12; i += 1) {
        fs.writeFileSync(path.join(projectDir, `wip${i}.js`), '');
      }

      const { output } = runFull(['y', writeTsc('5.7.2')], []);

      expect(output).toContain('Uncommitted changes in');
      expect(output).toContain('(12)');
      expect(output).toContain('... and 2 more');
    });

    it('warns under --no-commit, where nothing holds a copy of an untracked file', () => {
      fs.writeFileSync(path.join(projectDir, 'wip.js'), '');

      const { output } = runFull(['y', writeTsc('5.7.2')], ['--no-commit']);

      expect(output).toContain('?? wip.js');
      expect(output).toContain('no committed copy to recover it from');
      expect(output).not.toContain('git add .');
    });

    it('warns and continues under --yes', () => {
      fs.writeFileSync(path.join(projectDir, 'wip.js'), '');

      const { status, output } = runFull([], ['--yes', '--no-commit']);

      expect(status).toBe(0);
      expect(output).toContain('?? wip.js');
      expect(output).toContain('--yes was passed, so the run continues.');
      expect(output).toContain('All done!');
    });

    it('adds no prompt of its own to the interactive path', () => {
      fs.writeFileSync(path.join(projectDir, 'wip.js'), '');

      const { status, output } = runFull(['n'], ['--no-commit']);

      expect(status).toBe(0);
      expect(output).toContain('?? wip.js');
      expect(output).toContain('See you later.');
      expect(output).not.toContain('Step 1 of 4');
    });
  });
});

describe('a ts-migrate-full folder whose path has a space', () => {
  it('is one argument to every command the run passes it to', () => {
    const spacedDir = path.join(installDir, 'my project');
    fs.renameSync(projectDir, spacedDir);
    projectDir = spacedDir;

    const { status, output } = runFull(['y', writeTsc('5.7.2')]);

    expect(status).toBe(0);
    // Step 1 writes this when the project has no ESLint config, and the
    // migrate step removes it again.
    expect(fs.existsSync(path.join(spacedDir, '.eslintrc'))).toBe(false);
    expect(output).toContain('All done!');
  });
});
