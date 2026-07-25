import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The parser as it ships: the built CLI in a child process, so exit codes and
 * the width yargs wraps to off a TTY are the ones a script or an agent sees.
 */
const cliPath = path.resolve(__dirname, '..', 'build', 'cli.js');

/** The width `--help` wraps to when stdout is not a terminal. */
const HELP_COLUMNS = 100;

let projectDir: string;

beforeAll(() => {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`${cliPath} does not exist. Run \`pnpm run build\` before the tests.`);
  }
  projectDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-cli-'));
  fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), '{ "include": ["."] }\n');
  fs.writeFileSync(path.join(projectDir, 'a.ts'), 'export const a: any = 1;\n');
});

afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('command names', () => {
  it('rejects a name that is not a command', () => {
    const { status, output } = runCli(['frobnicate', projectDir]);

    expect(output).toContain('Unknown command');
    expect(output).toContain('frobnicate');
    expect(status).toBe(1);
  }, 30000);

  it('names the command a typo was probably meant to be', () => {
    const { status, output } = runCli(['migate', projectDir]);

    expect(output).toContain('Did you mean migrate?');
    expect(status).toBe(1);
  }, 30000);

  it('still asks for a command when none is given', () => {
    const { status, output } = runCli([]);

    expect(output).toContain('Must provide a command.');
    expect(status).toBe(1);
  }, 30000);

  it('runs a command that exists', () => {
    const { status, output } = runCli(['report', projectDir]);

    expect(output).toContain('a.ts');
    expect(status).toBe(0);
  }, 30000);

  it('rejects an argument past the ones a command declares', () => {
    const { status, output } = runCli(['report', projectDir, 'stray']);

    expect(output).toContain('Unknown command');
    expect(output).toContain('stray');
    expect(status).toBe(1);
  }, 30000);

  // ts-migrate-full forwards one argument list to both rename and migrate, and
  // the two accept different flags, so an unrecognized option is not an error.
  it('accepts an option the command does not declare', () => {
    const { status } = runCli(['report', projectDir, '--notAFlag']);

    expect(status).toBe(0);
  }, 30000);

  // The value of such an option is the option's, not a second positional.
  it('accepts an option the command does not declare with a value', () => {
    const { status } = runCli([
      'report',
      projectDir,
      '--typesReportFile',
      path.join(projectDir, 'types-report.json'),
    ]);

    expect(status).toBe(0);
  }, 30000);
});

describe('help output off a terminal', () => {
  it.each([
    ['ts-migrate', []],
    ['init', ['init']],
    ['rename', ['rename']],
    ['migrate', ['migrate']],
    ['reignore', ['reignore']],
    ['report', ['report']],
    ['check', ['check']],
  ])('wraps the help of %s', (_name, args) => {
    const { status, output } = runCli([...(args as string[]), '--help']);

    const tooWide = output.split('\n').filter((line) => line.length > HELP_COLUMNS);
    expect(tooWide).toEqual([]);
    expect(output).toContain('ts-migrate');
    expect(status).toBe(0);
  }, 30000);

  it.each([['rename'], ['migrate'], ['reignore'], ['report'], ['check']])(
    'prints only the positionals %s takes in its usage line',
    (name) => {
      const { output } = runCli([name, '--help']);

      expect(output).toContain(`ts-migrate ${name} <folder>`);
      expect(output).not.toContain('[options]');
    },
    30000,
  );

  it('documents the member accessibility flags', () => {
    const { output } = runCli(['migrate', '--help']);

    expect(output).toContain('--defaultAccessibility');
    expect(output).toContain('--privateRegex');
    expect(output).toContain('--protectedRegex');
    expect(output).toContain('--publicRegex');
  }, 30000);
});

describe('a migrate run with nothing to migrate', () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-unrenamed-'));
    fs.writeFileSync(
      path.join(emptyDir, 'tsconfig.json'),
      '{ "compilerOptions": { "types": [] }, "include": ["**/*.ts"] }\n',
    );
    fs.writeFileSync(path.join(emptyDir, 'a.js'), 'export const a = 1;\n');
  });

  afterAll(() => {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('exits nonzero naming TS18003 and the rename command', () => {
    const summaryFile = path.join(emptyDir, 'summary.json');
    const { status, output } = runCli(['migrate', emptyDir, '--jsonSummary', summaryFile]);

    expect(output).toContain('Migrating 0 file(s)');
    expect(output).toContain('No files to migrate');
    expect(output).toContain('TS18003');
    expect(output).toContain(`ts-migrate rename ${emptyDir}`);
    expect(status).not.toBe(0);

    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    expect(summary.filesToMigrate).toBe(0);
    expect(summary.exitCode).not.toBe(0);
  }, 120000);
});
