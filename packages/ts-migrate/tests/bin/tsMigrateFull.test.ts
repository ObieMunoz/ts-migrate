import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const packageRoot = path.resolve(__dirname, '..', '..');

/**
 * The pipeline itself is `ts-migrate full`, tested in process in
 * tests/commands/full. What is left in the shell script is the entry point npm
 * installs as `ts-migrate-full`, so what is left to test is that it finds the
 * CLI from wherever it was invoked and hands over the arguments and exit code
 * unchanged.
 */
let installDir: string;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-full-'));

  fs.mkdirSync(path.join(installDir, 'bin'));
  fs.copyFileSync(
    path.join(packageRoot, 'bin', 'ts-migrate-full.sh'),
    path.join(installDir, 'bin', 'ts-migrate-full.sh'),
  );

  fs.mkdirSync(path.join(installDir, 'build'));
  // Reports the argument list it was handed, and exits with the code the test
  // asked for, so the shim's own behavior is all that is under test.
  fs.writeFileSync(
    path.join(installDir, 'build', 'cli.js'),
    `console.log(JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.STUB_CLI_EXIT_CODE || 0));
`,
  );
});

afterEach(() => {
  fs.rmSync(installDir, { recursive: true, force: true });
});

function runShim(
  args: string[],
  { script = path.join(installDir, 'bin', 'ts-migrate-full.sh'), env = {}, cwd = installDir } = {},
): { status: number; argv: string[]; output: string } {
  try {
    const output = execFileSync('bash', [script, ...args], {
      encoding: 'utf-8',
      cwd,
      env: { ...process.env, ...env },
    });
    return { status: 0, argv: JSON.parse(output), output };
  } catch (err: any) {
    return { status: err.status, argv: [], output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('the ts-migrate-full shim', () => {
  it('runs the full command with the arguments it was given', () => {
    const { status, argv } = runShim(['some/folder', '--yes', '--no-commit']);

    expect(status).toBe(0);
    expect(argv).toEqual(['full', 'some/folder', '--yes', '--no-commit']);
  });

  it('keeps a folder whose path has a space as one argument', () => {
    const { argv } = runShim(['my project', '--yes']);

    expect(argv).toEqual(['full', 'my project', '--yes']);
  });

  it('forwards the rename and migrate flags unchanged', () => {
    const { argv } = runShim([
      'folder',
      '--sources',
      'src/**/*',
      '--exclude-plugin',
      'ts-ignore',
      '--typescript',
      '/opt/ts',
    ]);

    expect(argv).toEqual([
      'full',
      'folder',
      '--sources',
      'src/**/*',
      '--exclude-plugin',
      'ts-ignore',
      '--typescript',
      '/opt/ts',
    ]);
  });

  it('exits with the code the command exited with', () => {
    const { status } = runShim(['folder'], { env: { STUB_CLI_EXIT_CODE: '255' } });

    expect(status).toBe(255);
  });

  it('finds the CLI through the symlink npm puts in .bin, from any directory', () => {
    const binLink = path.join(installDir, 'node_modules', '.bin');
    fs.mkdirSync(binLink, { recursive: true });
    const linkPath = path.join(binLink, 'ts-migrate-full');
    fs.symlinkSync(path.join(installDir, 'bin', 'ts-migrate-full.sh'), linkPath);

    const { status, argv } = runShim(['folder'], { script: linkPath, cwd: os.tmpdir() });

    expect(status).toBe(0);
    expect(argv).toEqual(['full', 'folder']);
  });
});
