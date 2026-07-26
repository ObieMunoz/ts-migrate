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

  // Options went unchecked while ts-migrate-full forwarded one argument list to
  // both rename and migrate; `full` declares that union itself now, so a flag
  // nothing accepts is a typo worth failing on.
  it('rejects an option the command does not declare', () => {
    const { status, output } = runCli(['report', projectDir, '--notAFlag']);

    expect(output).toContain('Unknown argument');
    expect(output).toContain('notAFlag');
    expect(status).not.toBe(0);
  }, 30000);

  it('rejects an option another command declares', () => {
    const { status, output } = runCli([
      'report',
      projectDir,
      '--typesReportFile',
      path.join(projectDir, 'types-report.json'),
    ]);

    expect(output).toContain('Unknown argument');
    expect(status).not.toBe(0);
  }, 30000);

  // A single plugin leaves the errors the rest of the pipeline would have
  // resolved, so the compile check closing a full run would fail by
  // construction. It stays on migrate, which has no such check.
  it('rejects --plugin on full and accepts it on migrate', () => {
    const full = runCli(['full', projectDir, '--plugin', 'jsdoc', '--yes', '--dry-run']);
    expect(full.output).toContain('Unknown argument');
    expect(full.status).not.toBe(0);

    const migrate = runCli(['migrate', '--help']);
    expect(migrate.output).toContain('--plugin');
  }, 30000);

  it('still accepts every flag full forwards to its steps', () => {
    const { status, output } = runCli([
      'full',
      projectDir,
      '--sources',
      '**/*',
      '--exclude-plugin',
      'ts-ignore',
      '--aliases',
      'tsfixme',
      '--maxStablePasses',
      '3',
      '--no-inferTypes',
      '--no-commit',
      '--yes',
      '--dry-run',
    ]);

    expect(output).not.toContain('Unknown argument');
    expect(status).toBe(0);
  }, 60000);
});

describe('a <folder> that is not a directory', () => {
  it.each([
    ['init'],
    ['init:extended'],
    ['rename'],
    ['migrate'],
    ['reignore'],
    ['report'],
    ['check'],
  ])('makes %s name the folder and exit nonzero', (name) => {
    const missing = path.join(projectDir, 'not-here');

    const { status, output } = runCli([name, missing]);

    expect(output).toContain(`${missing} does not exist`);
    // The commands that read a config named tsconfig.json inside a directory
    // that is not there, which points at the wrong thing to fix.
    expect(output).not.toContain('tsconfig.json');
    expect(status).toBe(255);
  }, 30000);

  it('rejects a path that exists but is a file', () => {
    const filePath = path.join(projectDir, 'a.ts');

    const { status, output } = runCli(['init', filePath]);

    expect(output).toContain(`${filePath} is not a directory`);
    expect(status).toBe(255);
  }, 30000);
});

// An empty directory is a directory: init writes the config a migration of it
// will need, so it is not the missing-folder case.
describe('a <folder> that exists', () => {
  it('initializes an empty one', () => {
    const emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-empty-'));

    try {
      const { status, output } = runCli(['init', emptyDir]);

      expect(status).toBe(0);
      expect(output).toContain('Config file created at');
      expect(fs.existsSync(path.join(emptyDir, 'tsconfig.json'))).toBe(true);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 30000);

  it('leaves an existing tsconfig.json alone', () => {
    const { status, output } = runCli(['init', projectDir]);

    expect(status).toBe(0);
    expect(output).toContain('Config file already exists at');
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

describe('flag spelling', () => {
  /**
   * The flag names out of a help screen's option column. Description text
   * wraps to a deeper indent than any flag is printed at, so the column is
   * what separates a declared flag from a `--no-foo` named in a description.
   */
  function flagNames(help: string): string[] {
    return help
      .split('\n')
      .map((line) => /^ {2,6}(?:-\w, )?--([A-Za-z][\w-]*)/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]);
  }

  it.each([
    ['ts-migrate', []],
    ['full', ['full']],
    ['rename', ['rename']],
    ['migrate', ['migrate']],
    ['reignore', ['reignore']],
    ['report', ['report']],
    ['check', ['check']],
  ])('prints every flag of %s in camelCase', (_name, args) => {
    const { output } = runCli([...(args as string[]), '--help']);

    const names = flagNames(output);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => name.includes('-'))).toEqual([]);
  }, 30000);

  // These four were the canonical spelling before camelCase was settled on, so
  // they are the ones already written into scripts and CI jobs. yargs expands
  // a dashed flag onto its camelCase key, and this is what holds it to that:
  // each still has to reach the handler, not merely parse.
  it('still renames nothing under the dashed --dry-run', () => {
    const dryRunDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-dashed-'));

    try {
      fs.writeFileSync(path.join(dryRunDir, 'tsconfig.json'), '{ "include": ["."] }\n');
      fs.writeFileSync(path.join(dryRunDir, 'a.js'), 'export const a = 1;\n');

      const { status, output } = runCli(['rename', dryRunDir, '--dry-run']);

      expect(output).toContain('a.js -> a.ts');
      expect(fs.existsSync(path.join(dryRunDir, 'a.js'))).toBe(true);
      expect(status).toBe(0);
    } finally {
      fs.rmSync(dryRunDir, { recursive: true, force: true });
    }
  }, 30000);

  it('still writes a baseline under the dashed --update-baseline', () => {
    const baselineFile = path.join(projectDir, 'dashed-baseline.json');

    const { status, output } = runCli([
      'check',
      projectDir,
      '--update-baseline',
      '--baselineFile',
      baselineFile,
    ]);

    expect(output).not.toContain('Unknown argument');
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(status).toBe(0);
  }, 30000);

  // choices is validated against the key a flag was declared under, which
  // `strip-dashed` drops. That setting is off, and both spellings being
  // rejected here is what says so: with it on and a dashed declaration, an
  // unknown plugin name goes through in silence.
  it.each([['--exclude-plugin'], ['--excludePlugin']])(
    'rejects an unknown plugin name given to %s',
    (spelling) => {
      const { status, output } = runCli(['migrate', projectDir, spelling, 'no-such-plugin']);

      expect(output).toContain('Invalid values');
      expect(output).toContain('Argument: excludePlugin');
      expect(status).not.toBe(0);
    },
    30000,
  );

  // The conflict is declared against the camelCase key, so reporting it is
  // proof the dashed spelling landed there rather than on a key of its own.
  it('still reaches excludePlugin from the dashed --exclude-plugin', () => {
    const { status, output } = runCli([
      'migrate',
      projectDir,
      '--exclude-plugin',
      'ts-ignore',
      '--plugin',
      'jsdoc',
    ]);

    expect(output).toContain('Arguments plugin and excludePlugin are mutually exclusive');
    expect(status).not.toBe(0);
  }, 30000);

  // The documented way to switch a boolean off, and the reason the help text
  // does not have to print `--no-inferTypes`: a dashed prefix on a camelCase
  // name is neither spelling. `--flag=false` is what tsc takes.
  it('switches a boolean off with =false, on every kind of flag', () => {
    const off = runCli(['migrate', projectDir, '--inferTypes=false', '--dry-run']);
    expect(off.output).not.toContain('Unknown argument');
    expect(off.status).toBe(0);

    // A plugin dropped is one fewer pass, which is the flag having landed
    // rather than merely parsed.
    const passes = (output: string) => /Plugin 1 of (\d+)/.exec(output)?.[1];
    const on = runCli(['migrate', projectDir, '--dry-run']);
    expect(passes(off.output)).not.toEqual(passes(on.output));

    // Single-word flags and the ones only `full` declares take it too.
    const fullRun = runCli([
      'full',
      projectDir,
      '--commit=false',
      '--gitignore=false',
      '--yes',
      '--dry-run',
    ]);
    expect(fullRun.output).not.toContain('Unknown argument');
    expect(fullRun.status).toBe(0);
  }, 120000);

  // Still the yargs-native form, and still what older scripts pass.
  it('still accepts the dashed --blame-ignore-revs and --no-infer-types on full', () => {
    const { status, output } = runCli([
      'full',
      projectDir,
      '--blame-ignore-revs',
      '--no-infer-types',
      '--max-stable-passes',
      '2',
      '--yes',
      '--dry-run',
    ]);

    expect(output).not.toContain('Unknown argument');
    expect(status).toBe(0);
  }, 60000);
});

describe('the config file', () => {
  const CONFIG_FILE_NAME = 'ts-migrate.config.json';

  let configDir: string;

  /** A project the fast commands can read, outside every other suite's tree. */
  function writeProject(dir: string): void {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "include": ["."] }\n');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a: any = 1;\n');
  }

  function writeConfig(text: string, dir = configDir): string {
    const configPath = path.join(dir, CONFIG_FILE_NAME);
    fs.writeFileSync(configPath, text);
    return configPath;
  }

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-config-'));
    writeProject(configDir);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('takes flags from a file next to the folder, and says which file', () => {
    const baselineFile = path.join(configDir, 'from-config.json');
    const configPath = writeConfig(
      JSON.stringify({ updateBaseline: true, check: { baselineFile } }),
    );

    const { status, output } = runCli(['check', configDir]);

    expect(output).toContain(`Flags from ${configPath}`);
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(status).toBe(0);
  }, 30000);

  it('finds one above the folder', () => {
    const nested = path.join(configDir, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    writeProject(nested);
    const baselineFile = path.join(configDir, 'from-above.json');
    writeConfig(JSON.stringify({ updateBaseline: true, check: { baselineFile } }));

    const { status } = runCli(['check', nested]);

    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(status).toBe(0);
  }, 30000);

  it('lets a flag on the command line override the file', () => {
    const fromFile = path.join(configDir, 'from-config.json');
    const fromFlag = path.join(configDir, 'from-flag.json');
    writeConfig(JSON.stringify({ updateBaseline: true, check: { baselineFile: fromFile } }));

    const { status } = runCli(['check', configDir, '--baselineFile', fromFlag]);

    expect(fs.existsSync(fromFlag)).toBe(true);
    expect(fs.existsSync(fromFile)).toBe(false);
    expect(status).toBe(0);
  }, 30000);

  it('reads the file --config names instead of searching', () => {
    const elsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-cfg-'));

    try {
      const baselineFile = path.join(configDir, 'from-named.json');
      const configPath = path.join(elsewhere, 'named.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ updateBaseline: true, check: { baselineFile } }),
      );

      const { status, output } = runCli(['check', configDir, '--config', configPath]);

      expect(output).toContain(`Flags from ${configPath}`);
      expect(fs.existsSync(baselineFile)).toBe(true);
      expect(status).toBe(0);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 30000);

  // Keys take either spelling, for the same reason the flags do.
  it('takes a dashed key as readily as a camelCase one', () => {
    const baselineFile = path.join(configDir, 'from-dashed-key.json');
    writeConfig(
      JSON.stringify({ 'update-baseline': true, check: { 'baseline-file': baselineFile } }),
    );

    const { status, output } = runCli(['check', configDir]);

    expect(output).not.toContain('is not a ts-migrate flag');
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(status).toBe(0);
  }, 30000);

  // Silently ignoring a mistyped flag costs a whole migration run to notice,
  // which is why the command line rejects one; the file is held to the same.
  it('exits nonzero naming a key that is not a flag', () => {
    const configPath = writeConfig(JSON.stringify({ infrTypes: false }));

    const { status, output } = runCli(['check', configDir]);

    expect(output).toContain(`${configPath}: "infrTypes" is not a ts-migrate flag`);
    expect(status).not.toBe(0);
  }, 30000);

  // One file serves the whole project, and `check` takes a fraction of the
  // flags a migration does.
  it('ignores a flag meant for another command', () => {
    writeConfig(JSON.stringify({ inferTypes: false, sources: 'app/**/*' }));

    const { status, output } = runCli(['check', configDir]);

    expect(output).not.toContain('Unknown argument');
    expect(status).toBe(0);
  }, 30000);

  it('leaves report --json machine-readable', () => {
    writeConfig(JSON.stringify({ gitignore: false }));

    const { status, output } = runCli(['report', configDir, '--json']);

    expect(() => JSON.parse(output)).not.toThrow();
    expect(status).toBe(0);
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

describe('a migrate run that fails', () => {
  let brokenDir: string;

  beforeAll(() => {
    brokenDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-broken-'));
    fs.writeFileSync(
      path.join(brokenDir, 'tsconfig.json'),
      '{ "compilerOptions": { "types": [] }, "include": ["**/*.ts"] }\n',
    );
    fs.writeFileSync(path.join(brokenDir, 'ok.ts'), 'export const ok = 1;\n');
    // Valid sloppy-mode JavaScript that TypeScript cannot parse. No plugin can
    // repair it, so the run ends nonzero with the file still unparseable.
    fs.writeFileSync(path.join(brokenDir, 'broken.ts'), "const legal = 'Copyright \\251 ACME';\n");
  });

  afterAll(() => {
    fs.rmSync(brokenDir, { recursive: true, force: true });
  });

  it('ends on a failure line and records the files in the summary', () => {
    const summaryFile = path.join(brokenDir, 'summary.json');
    const { status, output } = runCli(['migrate', brokenDir, '--jsonSummary', summaryFile]);

    expect(status).not.toBe(0);
    expect(output).toContain(
      'Migration failed: 1 file(s) still have syntax errors. See the errors above.',
    );

    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    expect(summary.migratedFilesWithSyntaxErrors).toEqual(['broken.ts']);
    expect(summary.pluginErrors).toEqual([]);
    expect(summary.exitCode).not.toBe(0);
  }, 180000);

  it('prints no failure line for a run that succeeds', () => {
    const okDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ts-migrate-ok-'));
    try {
      fs.writeFileSync(
        path.join(okDir, 'tsconfig.json'),
        '{ "compilerOptions": { "types": [] }, "include": ["**/*.ts"] }\n',
      );
      fs.writeFileSync(path.join(okDir, 'ok.ts'), 'export const ok = 1;\n');
      const summaryFile = path.join(okDir, 'summary.json');

      const { status, output } = runCli(['migrate', okDir, '--jsonSummary', summaryFile]);

      expect(status).toBe(0);
      expect(output).not.toContain('Migration failed');

      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      expect(summary.filesToMigrate).toBe(1);
      expect(summary.migratedFilesWithSyntaxErrors).toEqual([]);
      expect(summary.pluginErrors).toEqual([]);
    } finally {
      fs.rmSync(okDir, { recursive: true, force: true });
    }
  }, 180000);
});
