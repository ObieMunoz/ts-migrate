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

/**
 * The same run with stderr merged into stdout by the shell, so the transcript
 * is in the order a terminal shows it. Concatenating the two captured streams
 * instead would put every warning after every info line.
 */
function runCliInOrder(args: string[]): { status: number | null; output: string } {
  const command = [process.execPath, cliPath, ...args]
    .map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`)
    .join(' ');
  const result = spawnSync('/bin/sh', ['-c', `${command} 2>&1`], { encoding: 'utf-8' });
  return { status: result.status, output: result.stdout };
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

  it.each([['migrate'], ['reignore']])('documents the type package preflight of %s', (name) => {
    const { output } = runCli([name, '--help']);

    expect(output).toContain('--typesPreflight');
  }, 30000);
});

describe('the type package preflight', () => {
  const PREFLIGHT_HEADING = 'Type packages worth installing before the migration:';
  const PINNED_TYPES_REMINDER = 'Then add each one to the "types" array';

  let preflightDir: string;

  /**
   * A project the preflight can read: a declared test runner that resolves
   * through node_modules, and no @types package for it or for node.
   */
  function writeProject(compilerOptions: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(preflightDir, 'package.json'),
      JSON.stringify({ name: 'preflight-project', devDependencies: { jest: '^29.0.0' } }),
    );
    fs.writeFileSync(path.join(preflightDir, 'pnpm-lock.yaml'), '');
    const jestDir = path.join(preflightDir, 'node_modules', 'jest');
    fs.mkdirSync(jestDir, { recursive: true });
    fs.writeFileSync(path.join(jestDir, 'package.json'), JSON.stringify({ name: 'jest' }));
    fs.writeFileSync(
      path.join(preflightDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions, include: ['.'] }),
    );
    fs.writeFileSync(path.join(preflightDir, 'a.ts'), 'export const broken: number = "oops";\n');
  }

  beforeEach(() => {
    preflightDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-preflight-'));
  });

  afterEach(() => {
    fs.rmSync(preflightDir, { recursive: true, force: true });
  });

  it('names the missing type packages before migrate runs a plugin', () => {
    writeProject({ noEmit: true, strict: true, types: [] });

    const { status, output } = runCliInOrder(['migrate', preflightDir, '--plugin', 'ts-ignore']);

    expect(output).toContain('@types/node is not installed');
    expect(output).toContain('@types/jest is not installed');
    expect(output).toContain('Install: pnpm add -D @types/node @types/jest');
    expect(output.indexOf(PREFLIGHT_HEADING)).toBeLessThan(output.indexOf('[ts-ignore] Plugin 1'));
    // Advice, so the run still finishes and suppresses what it found.
    expect(fs.readFileSync(path.join(preflightDir, 'a.ts'), 'utf8')).toMatch(/@ts-expect-error/);
    expect(status).toBe(0);
  }, 60000);

  it('names them before reignore runs a plugin too', () => {
    writeProject({ noEmit: true, strict: true, types: [] });

    const { status, output } = runCliInOrder(['reignore', preflightDir]);

    expect(output).toContain('@types/node is not installed');
    expect(output).toContain('@types/jest is not installed');
    expect(output.indexOf(PREFLIGHT_HEADING)).toBeLessThan(
      output.indexOf('[strip-ts-ignore] Plugin 1'),
    );
    expect(status).toBe(0);
  }, 60000);

  it('says nothing under --no-typesPreflight', () => {
    writeProject({ noEmit: true, strict: true, types: [] });

    const { status, output } = runCliInOrder([
      'migrate',
      preflightDir,
      '--plugin',
      'ts-ignore',
      '--no-typesPreflight',
    ]);

    expect(output).not.toContain(PREFLIGHT_HEADING);
    expect(status).toBe(0);
  }, 60000);

  it('asks for a "types" entry when the tsconfig it runs against pins one', () => {
    writeProject({ noEmit: true, strict: true, types: [] });

    const { output } = runCliInOrder(['migrate', preflightDir, '--plugin', 'ts-ignore']);

    expect(output).toContain(PINNED_TYPES_REMINDER);
  }, 60000);

  it('leaves it out when the tsconfig pins no "types" array', () => {
    writeProject({ noEmit: true, strict: true });

    const { output } = runCliInOrder(['migrate', preflightDir, '--plugin', 'ts-ignore']);

    expect(output).toContain(PREFLIGHT_HEADING);
    expect(output).not.toContain(PINNED_TYPES_REMINDER);
  }, 60000);
});
