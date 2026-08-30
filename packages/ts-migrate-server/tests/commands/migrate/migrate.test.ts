import path from 'path';
import fs from 'fs';
import ts from 'typescript';
import log from 'updatable-log';
import { createDir, copyDir, deleteDir, getDirData, hashDir } from '@obiemunoz/ts-migrate-test-utils';
import migrate, { MigrateConfig } from '../../../src/migrate';

jest.mock('updatable-log', () => {
  const { mockUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return mockUpdatableLog();
});

const fixturesDir = path.resolve(__dirname, '../../fixtures');

describe('migrate command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  // Records the files it is handed and rewrites each one, so anything in the
  // migration set is both named and edited.
  const rewritingConfig = () => {
    const visited: string[] = [];
    const config = new MigrateConfig().addPlugin(
      {
        name: 'rewriting-plugin',
        run({ fileName, text }) {
          visited.push(path.relative(rootDir, fileName).split(path.sep).join('/'));
          return `${text}// touched\n`;
        },
      },
      {},
    );
    return { config, visited };
  };

  it('Migrates project', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    const outputDir = path.resolve(fixturesDir, 'migrate/output');
    const configDir = path.resolve(fixturesDir, 'tsconfig');

    copyDir(inputDir, rootDir);
    copyDir(configDir, rootDir);

    const config = new MigrateConfig().addPlugin(
      {
        name: 'test-plugin',
        run({ text }) {
          const newText = text.replace('test string', 'updated string');
          return newText;
        },
      },
      {},
    );

    const { exitCode, updatedFileTexts } = await migrate({ rootDir, config });
    fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(exitCode).toBe(0);
    // The returned texts are the same contents the write loop persisted.
    updatedFileTexts.forEach((text, fileName) => {
      expect(fs.readFileSync(fileName, 'utf8')).toBe(text);
    });
    expect(updatedFileTexts.size).toBeGreaterThan(0);
  });

  describe('dryRun', () => {
    it('leaves the tree byte-identical and returns the would-be contents', async () => {
      const inputDir = path.resolve(fixturesDir, 'migrate/input');
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(inputDir, rootDir);
      copyDir(configDir, rootDir);
      const hashBefore = hashDir(rootDir);

      const config = new MigrateConfig().addPlugin(
        {
          name: 'test-plugin',
          run({ text }) {
            return text.replace('test string', 'updated string');
          },
        },
        {},
      );

      const { exitCode, updatedSourceFiles, updatedFileTexts } = await migrate({
        rootDir,
        config,
        dryRun: true,
      });

      expect(exitCode).toBe(0);
      expect(hashDir(rootDir)).toBe(hashBefore);
      const indexFile = path.resolve(rootDir, 'index.ts');
      expect(updatedSourceFiles).toContain(indexFile);
      expect(updatedFileTexts.get(indexFile)).toContain('updated string');
      expect(fs.readFileSync(indexFile, 'utf8')).toContain('test string');
    });

    it('includes virtual files in the program without writing them', async () => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
      );
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), 'export const x: $TSFixMe = 1;\n');
      const hashBefore = hashDir(rootDir);

      const { config, diagnosticsByFile } = (() => {
        const byFile = new Map<string, number[]>();
        return {
          diagnosticsByFile: byFile,
          config: new MigrateConfig().addPlugin(
            {
              name: 'record-diagnostics',
              run({ fileName, text, getLanguageService }) {
                byFile.set(
                  path.relative(rootDir, fileName),
                  getLanguageService()
                    .getSemanticDiagnostics(fileName)
                    .map(({ code }) => code),
                );
                return text;
              },
            },
            {},
          ),
        };
      })();

      const { exitCode } = await migrate({
        rootDir,
        config,
        dryRun: true,
        virtualFiles: [
          {
            fileName: path.resolve(rootDir, 'ts-migrate-aliases.d.ts'),
            text: 'type $TSFixMe = any;\n',
          },
        ],
      });

      expect(exitCode).toBe(0);
      // The alias resolves through the virtual declaration file...
      expect(diagnosticsByFile.get('index.ts')).toEqual([]);
      // ...which itself never reaches the disk.
      expect(hashDir(rootDir)).toBe(hashBefore);
    });
  });

  describe('addGeneratedFile', () => {
    const declarationsFile = 'types/generated.d.ts';
    const declarationsText = "declare module 'untyped-lib';\n";

    /**
     * A plugin that generates the declaration file, followed by one recording
     * what the program makes of the file that imports the declared module.
     */
    function generateAndRecord(): {
      config: MigrateConfig;
      diagnosticCodes: number[][];
      programs: ts.Program[];
    } {
      const diagnosticCodes: number[][] = [];
      const programs: ts.Program[] = [];
      const config = new MigrateConfig()
        .addPlugin(
          {
            name: 'generate-declarations',
            run({ rootDir: dir, addGeneratedFile, getLanguageService }) {
              const program = getLanguageService().getProgram();
              if (program) programs.push(program);
              addGeneratedFile?.(path.resolve(dir, declarationsFile), declarationsText);
              return undefined;
            },
          },
          {},
        )
        .addPlugin(
          {
            name: 'record-diagnostics',
            run({ fileName, getLanguageService }) {
              const languageService = getLanguageService();
              const program = languageService.getProgram();
              if (program) programs.push(program);
              diagnosticCodes.push(
                languageService.getSemanticDiagnostics(fileName).map(({ code }) => code),
              );
              return undefined;
            },
          },
          {},
        );
      return { config, diagnosticCodes, programs };
    }

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
      );
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), "import 'untyped-lib';\n");
    });

    it('adds the file to the program and writes it with the rest of the run', async () => {
      const { config, diagnosticCodes } = generateAndRecord();

      const { exitCode, generatedFiles } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      // The import resolves through the generated declaration instead of TS2307.
      expect(diagnosticCodes).toEqual([[]]);
      const filePath = path.resolve(rootDir, declarationsFile);
      expect([...generatedFiles]).toEqual([[filePath, declarationsText]]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(declarationsText);
    });

    it('leaves the file unwritten on a dry run', async () => {
      const hashBefore = hashDir(rootDir);
      const { config, diagnosticCodes } = generateAndRecord();

      const { exitCode, generatedFiles } = await migrate({ rootDir, config, dryRun: true });

      expect(exitCode).toBe(0);
      expect(diagnosticCodes).toEqual([[]]);
      expect(generatedFiles.get(path.resolve(rootDir, declarationsFile))).toBe(declarationsText);
      expect(hashDir(rootDir)).toBe(hashBefore);
    });

    it('keeps the program when the file it would generate is already there', async () => {
      fs.mkdirSync(path.resolve(rootDir, 'types'));
      fs.writeFileSync(path.resolve(rootDir, declarationsFile), declarationsText);
      const { config, diagnosticCodes, programs } = generateAndRecord();

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(diagnosticCodes).toEqual([[]]);
      // Regenerating identical declarations must not cost a program rebuild:
      // every file checked so far would lose its cached diagnostics.
      expect(programs).toHaveLength(2);
      expect(programs[0]).toBe(programs[1]);
    });
  });

  /**
   * A read-only file, a full disk or a directory the run may not write is a
   * fact about the project. The write used to reject out of `migrate` and past
   * the command into yargs, which answered it with the help screen and the raw
   * Node error. Rejected rather than chmodded: the tests run as root often
   * enough that a mode change is not a reliable way to make a write fail.
   */
  describe('a file the run cannot write', () => {
    const readOnly = (fileName: string) =>
      Object.assign(new Error(`EACCES: permission denied, open '${fileName}'`), {
        code: 'EACCES',
      });

    /** Rejects the write of `blocked` and lets every other one through. */
    function blockWrite(blocked: string) {
      const { writeFile } = fs.promises;
      return jest
        .spyOn(fs.promises, 'writeFile')
        .mockImplementation((file, ...rest) =>
          file === blocked ? Promise.reject(readOnly(blocked)) : writeFile(file, ...rest),
        );
    }

    const renamingPlugin = new MigrateConfig().addPlugin(
      {
        name: 'test-plugin',
        run: ({ text }) => text.replace('test string', 'updated string'),
      },
      {},
    );

    beforeEach(() => {
      copyDir(path.resolve(fixturesDir, 'tsconfig'), rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'blocked.ts'), "console.log('test string');\n");
      fs.writeFileSync(path.resolve(rootDir, 'writable.ts'), "console.log('test string');\n");
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reports it, writes the rest of the run, and fails', async () => {
      const blocked = path.resolve(rootDir, 'blocked.ts');
      blockWrite(blocked);
      const error = jest.spyOn(log, 'error');

      const { exitCode, updatedSourceFiles, updatedFileTexts } = await migrate({
        rootDir,
        config: renamingPlugin,
      });

      expect(exitCode).not.toBe(0);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('blocked.ts'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
      // A file that never reached the disk is not a file the run migrated, so
      // it is out of the result the summary and the reports are built from.
      expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'writable.ts')]);
      expect([...updatedFileTexts.keys()]).toEqual([path.resolve(rootDir, 'writable.ts')]);
      // The one write that could land still did.
      expect(fs.readFileSync(path.resolve(rootDir, 'writable.ts'), 'utf8')).toContain(
        'updated string',
      );
      expect(fs.readFileSync(blocked, 'utf8')).toContain('test string');
    });

    it('reports a generated declaration file it cannot write', async () => {
      const generated = path.resolve(rootDir, 'types/generated.d.ts');
      blockWrite(generated);
      const error = jest.spyOn(log, 'error');

      const { exitCode, generatedFiles } = await migrate({
        rootDir,
        config: new MigrateConfig().addPlugin(
          {
            name: 'generate-declarations',
            run({ addGeneratedFile }) {
              addGeneratedFile?.(generated, "declare module 'untyped-lib';\n");
              return undefined;
            },
          },
          {},
        ),
      });

      expect(exitCode).not.toBe(0);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('generated.d.ts'));
      // Nothing may report the declarations as generated: no file declares
      // those modules, so the next tsc run would contradict it.
      expect([...generatedFiles]).toEqual([]);
      expect(fs.existsSync(generated)).toBe(false);
    });
  });

  describe('sources', () => {
    it('Migrates project by using `sources`', async () => {
      const inputDir = path.resolve(fixturesDir, 'migrate/input');
      const outputDir = path.resolve(fixturesDir, 'migrate/output');
      const configDir = path.resolve(fixturesDir, 'tsconfig');

      copyDir(inputDir, rootDir);
      copyDir(configDir, rootDir);

      const config = new MigrateConfig().addPlugin(
        {
          name: 'test-plugin',
          run({ text }) {
            const newText = text.replace('test string', 'updated string');
            return newText;
          },
        },
        {},
      );

      const { exitCode } = await migrate({
        rootDir,
        config,
        sources: 'index.ts',
      });
      fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
      const [rootData, outputData] = getDirData(rootDir, outputDir);
      expect(rootData).toEqual(outputData);
      expect(exitCode).toBe(0);
    });

    it('Migrates project by using `sources` with an absolute path', async () => {
      const inputDir = path.resolve(fixturesDir, 'migrate/input');
      const outputDir = path.resolve(fixturesDir, 'migrate/output');
      const configDir = path.resolve(fixturesDir, 'tsconfig');

      copyDir(inputDir, rootDir);
      copyDir(configDir, rootDir);

      const config = new MigrateConfig().addPlugin(
        {
          name: 'test-plugin',
          run({ text }) {
            const newText = text.replace('test string', 'updated string');
            return newText;
          },
        },
        {},
      );

      const { exitCode, updatedSourceFiles } = await migrate({
        rootDir,
        config,
        sources: path.resolve(rootDir, 'index.ts'),
      });
      fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
      const [rootData, outputData] = getDirData(rootDir, outputDir);
      expect(rootData).toEqual(outputData);
      expect(exitCode).toBe(0);

      const pathsRelativeToOutputDir = Array.from(updatedSourceFiles).map((filePath) =>
        path.relative(rootDir, filePath),
      );
      expect(pathsRelativeToOutputDir).toEqual(['index.ts']);
    });
  });

  describe('ambient declaration files', () => {
    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
      );
      fs.writeFileSync(
        path.resolve(rootDir, 'vite-env.d.ts'),
        'declare const __APP_VERSION__: string;\n',
      );
      fs.mkdirSync(path.resolve(rootDir, 'feature'));
      fs.writeFileSync(
        path.resolve(rootDir, 'feature/index.ts'),
        'export const version: string = __APP_VERSION__;\n',
      );
    });

    // Records each visited file's semantic diagnostic codes without editing.
    const recordDiagnosticsConfig = () => {
      const diagnosticsByFile = new Map<string, number[]>();
      const config = new MigrateConfig().addPlugin(
        {
          name: 'record-diagnostics',
          run({ fileName, text, getLanguageService }) {
            diagnosticsByFile.set(
              path.relative(rootDir, fileName),
              getLanguageService()
                .getSemanticDiagnostics(fileName)
                .map(({ code }) => code),
            );
            return text;
          },
        },
        {},
      );
      return { config, diagnosticsByFile };
    };

    it('keeps the tsconfig .d.ts files in the program for a sources-scoped run', async () => {
      const { config, diagnosticsByFile } = recordDiagnosticsConfig();
      const infoSpy = jest.spyOn(log, 'info');

      const { exitCode } = await migrate({ rootDir, config, sources: 'feature/**/*' });

      expect(exitCode).toBe(0);
      // The ambient global resolves, and the retained .d.ts is context only,
      // not part of the migration set.
      expect(diagnosticsByFile.get(path.join('feature', 'index.ts'))).toEqual([]);
      expect(Array.from(diagnosticsByFile.keys())).toEqual([path.join('feature', 'index.ts')]);
      const infoMessages = infoSpy.mock.calls.map((call) => call.join(' '));
      expect(infoMessages).toContainEqual(
        expect.stringContaining('Retaining 1 ambient declaration file(s) from tsconfig.json'),
      );
      expect(infoMessages).toContainEqual(expect.stringContaining('vite-env.d.ts'));
      infoSpy.mockRestore();
    });

    it('drops the tsconfig .d.ts files when ambientSources is disabled', async () => {
      const { config, diagnosticsByFile } = recordDiagnosticsConfig();

      const { exitCode } = await migrate({
        rootDir,
        config,
        sources: 'feature/**/*',
        ambientSources: false,
      });

      expect(exitCode).toBe(0);
      expect(diagnosticsByFile.get(path.join('feature', 'index.ts'))).toContain(2304);
    });
  });

  it('exits non-zero when a file still has syntax errors after all plugins', async () => {
    const configDir = path.resolve(fixturesDir, 'tsconfig');
    copyDir(configDir, rootDir);
    // Valid sloppy-mode JS (octal escape) that TypeScript cannot parse; no
    // plugin can repair it, so migrate must not report success.
    fs.writeFileSync(path.resolve(rootDir, 'index.ts'), "const legal = 'Copyright \\251 ACME';\n");

    const config = new MigrateConfig().addPlugin(
      {
        name: 'noop-plugin',
        run({ text }) {
          return text;
        },
      },
      {},
    );

    const { exitCode, migratedFilesWithSyntaxErrors } = await migrate({ rootDir, config });
    expect(exitCode).not.toBe(0);
    // The files are named on the result, not only in the log the run scrolls past.
    expect(migratedFilesWithSyntaxErrors).toEqual([path.resolve(rootDir, 'index.ts')]);
  });

  describe('plugin exceptions', () => {
    beforeEach(() => {
      copyDir(path.resolve(fixturesDir, 'tsconfig'), rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 2;\n');
    });

    it('records the plugin, the file and the message, and fails the run', async () => {
      const config = new MigrateConfig().addPlugin(
        {
          name: 'throws-on-b',
          run({ fileName, text }) {
            if (fileName.endsWith('b.ts')) throw new Error('the rule blew up');
            return text;
          },
        },
        {},
      );

      const { exitCode, pluginErrors } = await migrate({ rootDir, config });

      expect(exitCode).not.toBe(0);
      expect(pluginErrors).toEqual([
        { pluginName: 'throws-on-b', file: 'b.ts', message: 'the rule blew up' },
      ]);
    });

    it('bounds the message so a summary stays readable', async () => {
      const config = new MigrateConfig().addPlugin(
        {
          name: 'throws-long',
          run() {
            throw new Error(`${'x'.repeat(5000)}\nsecond line`);
          },
        },
        {},
      );

      const { pluginErrors } = await migrate({ rootDir, config });

      expect(pluginErrors).toHaveLength(2);
      pluginErrors.forEach(({ message }) => {
        expect(message.length).toBeLessThanOrEqual(300);
        expect(message.endsWith('...')).toBe(true);
        expect(message).not.toContain('\n');
      });
    });

    it('records nothing for a run where no plugin threw', async () => {
      const config = new MigrateConfig().addPlugin(
        { name: 'noop', run: ({ text }) => text },
        {},
      );

      const { exitCode, pluginErrors } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(pluginErrors).toEqual([]);
    });
  });

  it('reports syntax errors in files the migration cannot edit', async () => {
    // An explicit empty "types" keeps the fixture's program free of this
    // workspace's own @types packages (the fixture lives inside the repo).
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
    );
    fs.writeFileSync(
      path.resolve(rootDir, 'index.ts'),
      "import './generated';\nexport const a = 1;\n",
    );
    // A malformed declaration file, like a code generator can produce; it is
    // part of the program but never part of the migration set.
    fs.writeFileSync(
      path.resolve(rootDir, 'generated.d.ts'),
      'export { default as Widget.js } from "./widget";\n',
    );

    const config = new MigrateConfig();
    const { exitCode, nonMigratedFilesWithSyntaxErrors } = await migrate({ rootDir, config });

    // The migration itself succeeded; the broken input is surfaced, not owned.
    expect(exitCode).toBe(0);
    expect(nonMigratedFilesWithSyntaxErrors).toHaveLength(1);
    expect(nonMigratedFilesWithSyntaxErrors[0]).toMatch(/generated\.d\.ts$/);
  });

  it('does not flag parseable files outside the migration set', async () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
    );
    fs.writeFileSync(path.resolve(rootDir, 'index.ts'), "import './generated';\n");
    fs.writeFileSync(path.resolve(rootDir, 'generated.d.ts'), 'declare const widget: string;\n');

    const { nonMigratedFilesWithSyntaxErrors } = await migrate({
      rootDir,
      config: new MigrateConfig(),
    });

    expect(nonMigratedFilesWithSyntaxErrors).toEqual([]);
  });

  describe('repeatUntilStable', () => {
    it('re-runs the plugin group until a pass changes nothing', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), '8');

      const config = new MigrateConfig()
        .addPlugin(
          {
            name: 'halve-even',
            run({ text }) {
              const n = Number(text);
              return n % 2 === 0 ? String(n / 2) : text;
            },
          },
          {},
          { repeatUntilStable: true },
        )
        .addPlugin(
          {
            name: 'decrement-odd',
            run({ text }) {
              const n = Number(text);
              return n % 2 === 1 && n > 1 ? String(n - 1) : text;
            },
          },
          {},
          { repeatUntilStable: true },
        );

      const { exitCode } = await migrate({ rootDir, config });
      expect(fs.readFileSync(path.resolve(rootDir, 'index.ts'), 'utf8')).toBe('1');
      expect(exitCode).toBe(0);
    });

    it('caps the number of passes for a group that never stabilizes', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), 'x');

      const config = new MigrateConfig().addPlugin(
        {
          name: 'always-append',
          run({ text }) {
            return `${text}x`;
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config });
      expect(fs.readFileSync(path.resolve(rootDir, 'index.ts'), 'utf8')).toBe('xxxxxx');
      expect(exitCode).toBe(0);
    });

    it('revisits only files affected by the previous pass', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(
        path.resolve(rootDir, 'a.ts'),
        "import { b } from './b';\nexport const a = b;\n",
      );
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 1; // CHANGE_ME\n');
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const visited: string[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'change-b-once',
          run({ fileName, text }) {
            visited.push(path.basename(fileName));
            return text.replace('CHANGE_ME', 'CHANGED');
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config });
      // Pass 2 revisits the changed file and its importer, but not c.ts.
      expect(visited).toEqual(['a.ts', 'b.ts', 'c.ts', 'a.ts', 'b.ts']);
      expect(exitCode).toBe(0);
    });

    it('revisits transitive importers through re-exports', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 1; // CHANGE_ME\n');
      fs.writeFileSync(path.resolve(rootDir, 'barrel.ts'), "export * from './b';\n");
      fs.writeFileSync(
        path.resolve(rootDir, 'a.ts'),
        "import { b } from './barrel';\nexport const a = b;\n",
      );
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const visited: string[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'change-b-once',
          run({ fileName, text }) {
            visited.push(path.basename(fileName));
            return text.replace('CHANGE_ME', 'CHANGED');
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config });
      expect(visited).toEqual(['a.ts', 'b.ts', 'barrel.ts', 'c.ts', 'a.ts', 'b.ts', 'barrel.ts']);
      expect(exitCode).toBe(0);
    });

    it('revisits transitive importers through a namespace re-export', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 1; // CHANGE_ME\n');
      fs.writeFileSync(path.resolve(rootDir, 'barrel.ts'), "export * as ns from './b';\n");
      fs.writeFileSync(
        path.resolve(rootDir, 'a.ts'),
        "import { ns } from './barrel';\nexport const a = ns.b;\n",
      );
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const visited: string[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'change-b-once',
          run({ fileName, text }) {
            visited.push(path.basename(fileName));
            return text.replace('CHANGE_ME', 'CHANGED');
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config });
      expect(visited).toEqual(['a.ts', 'b.ts', 'barrel.ts', 'c.ts', 'a.ts', 'b.ts', 'barrel.ts']);
      expect(exitCode).toBe(0);
    });

    it('revisits every file when a changed file affects the global scope', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      // No import/export makes b.ts a script contributing to the global scope.
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'const b = 1; // CHANGE_ME\n');
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const visited: string[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'change-b-once',
          run({ fileName, text }) {
            visited.push(path.basename(fileName));
            return text.replace('CHANGE_ME', 'CHANGED');
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config });
      expect(visited).toEqual(['b.ts', 'c.ts', 'b.ts', 'c.ts']);
      expect(exitCode).toBe(0);
    });

    it('revisits every file with incrementalPasses disabled', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 1; // CHANGE_ME\n');
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const visited: string[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'change-b-once',
          run({ fileName, text }) {
            visited.push(path.basename(fileName));
            return text.replace('CHANGE_ME', 'CHANGED');
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config, incrementalPasses: false });
      expect(visited).toEqual(['b.ts', 'c.ts', 'b.ts', 'c.ts']);
      expect(exitCode).toBe(0);
    });

    it('honors a custom maxStablePasses cap', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), 'x');

      const config = new MigrateConfig().addPlugin(
        {
          name: 'always-append',
          run({ text }) {
            return `${text}x`;
          },
        },
        {},
        { repeatUntilStable: true },
      );

      const { exitCode } = await migrate({ rootDir, config, maxStablePasses: 2 });
      expect(fs.readFileSync(path.resolve(rootDir, 'index.ts'), 'utf8')).toBe('xxx');
      expect(exitCode).toBe(0);
    });

    it('runs unmarked plugins a single pass', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), '8');

      const config = new MigrateConfig().addPlugin(
        {
          name: 'halve-even',
          run({ text }) {
            const n = Number(text);
            return n % 2 === 0 ? String(n / 2) : text;
          },
        },
        {},
      );

      const { exitCode } = await migrate({ rootDir, config });
      expect(fs.readFileSync(path.resolve(rootDir, 'index.ts'), 'utf8')).toBe('4');
      expect(exitCode).toBe(0);
    });
  });

  describe('mutationsPreserveTypes', () => {
    const marker = '// touched\n';

    // A plugin that appends `marker` to every file and, for each file it
    // processes, records whether the shared program already reflects a sibling
    // file's edit made earlier in this same pass.
    const appendMarkerConfig = (mutationsPreserveTypes: boolean) => {
      const sawSiblingEdit: boolean[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'append-marker',
          mutationsPreserveTypes,
          run({ fileName, text, getLanguageService }) {
            const program = getLanguageService().getProgram();
            const sawSibling = Boolean(
              program &&
                program
                  .getSourceFiles()
                  .some(
                    (sf) =>
                      sf.fileName !== fileName &&
                      /\/[ab]\.ts$/.test(sf.fileName) &&
                      sf.text.includes(marker),
                  ),
            );
            sawSiblingEdit.push(sawSibling);
            return `${text}${marker}`;
          },
        },
        {},
      );
      return { config, sawSiblingEdit };
    };

    beforeEach(() => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 2;\n');
    });

    it('defers writes so the whole pass runs against one warm program', async () => {
      const { config, sawSiblingEdit } = appendMarkerConfig(true);

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      // Every deferred write is still flushed: no edit is dropped.
      expect(fs.readFileSync(path.resolve(rootDir, 'a.ts'), 'utf8')).toContain(marker);
      expect(fs.readFileSync(path.resolve(rootDir, 'b.ts'), 'utf8')).toContain(marker);
      // No file observed a sibling's edit mid-pass, so the program was never
      // rebuilt between files.
      expect(sawSiblingEdit).toEqual([false, false]);
    });

    it('applies writes immediately for ordinary plugins (contrast)', async () => {
      const { config, sawSiblingEdit } = appendMarkerConfig(false);

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(rootDir, 'a.ts'), 'utf8')).toContain(marker);
      expect(fs.readFileSync(path.resolve(rootDir, 'b.ts'), 'utf8')).toContain(marker);
      // The second file processed sees the first file's already-committed edit.
      expect(sawSiblingEdit).toContain(true);
    });
  });

  describe('independentFiles', () => {
    // A plugin that yields once mid-run and records how many of its run()
    // calls were in flight together.
    const overlapConfig = (independentFiles: boolean) => {
      let inFlight = 0;
      let maxInFlight = 0;
      const config = new MigrateConfig().addPlugin(
        {
          name: 'count-overlap',
          independentFiles,
          async run({ text }) {
            inFlight += 1;
            await new Promise((resolve) => {
              setImmediate(resolve);
            });
            maxInFlight = Math.max(maxInFlight, inFlight);
            inFlight -= 1;
            return `${text}// touched\n`;
          },
        },
        {},
      );
      return { config, getMaxInFlight: () => maxInFlight };
    };

    beforeEach(() => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 2;\n');
    });

    it('keeps every file in flight at once', async () => {
      const { config, getMaxInFlight } = overlapConfig(true);

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(getMaxInFlight()).toBe(2);
      expect(fs.readFileSync(path.resolve(rootDir, 'a.ts'), 'utf8')).toContain('// touched');
      expect(fs.readFileSync(path.resolve(rootDir, 'b.ts'), 'utf8')).toContain('// touched');
    });

    it('runs ordinary plugins one file at a time (contrast)', async () => {
      const { config, getMaxInFlight } = overlapConfig(false);

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(getMaxInFlight()).toBe(1);
    });

    it('isolates a failing file without dropping the others', async () => {
      const config = new MigrateConfig().addPlugin(
        {
          name: 'fail-on-b',
          independentFiles: true,
          async run({ fileName, text }) {
            if (fileName.endsWith('b.ts')) throw new Error('boom');
            return `${text}// touched\n`;
          },
        },
        {},
      );

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(-1);
      expect(fs.readFileSync(path.resolve(rootDir, 'a.ts'), 'utf8')).toContain('// touched');
      expect(fs.readFileSync(path.resolve(rootDir, 'b.ts'), 'utf8')).not.toContain('// touched');
    });
  });

  describe('pass progress', () => {
    it('logs occasional counter lines during a slow non-TTY pass', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 2;\n');
      fs.writeFileSync(path.resolve(rootDir, 'c.ts'), 'export const c = 3;\n');

      const infoSpy = jest.spyOn(log, 'info');
      const updateSpy = jest.spyOn(log, 'update');
      let fakeNow = 0;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
      const stdout = process.stdout as { isTTY?: boolean };
      const originalIsTTY = stdout.isTTY;
      stdout.isTTY = false;

      try {
        const config = new MigrateConfig().addPlugin(
          {
            name: 'slow-plugin',
            run({ text }) {
              fakeNow += 11_000;
              return text;
            },
          },
          {},
        );

        const { exitCode } = await migrate({ rootDir, config });

        expect(exitCode).toBe(0);
        const counterLines = infoSpy.mock.calls
          .map((call) => call.join(' '))
          .filter((message) => /^\[slow-plugin\] \d+\/\d+ /.test(message));
        // One line per elapsed interval, naming where the pass currently is;
        // nothing per file, nothing through the in-place updater.
        expect(counterLines).toEqual(['[slow-plugin] 2/3 b.ts', '[slow-plugin] 3/3 c.ts']);
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        stdout.isTTY = originalIsTTY;
        nowSpy.mockRestore();
        infoSpy.mockRestore();
        updateSpy.mockRestore();
      }
    });

    it('reports a repeated pass without moving the pipeline ordinal backwards', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'index.ts'), 'x');

      const infoSpy = jest.spyOn(log, 'info');
      try {
        const config = new MigrateConfig()
          .addPlugin(
            {
              name: 'grow',
              run({ text }) {
                return text.length < 3 ? `${text}x` : text;
              },
            },
            {},
            { repeatUntilStable: true },
          )
          .addPlugin(
            {
              name: 'noop',
              run({ text }) {
                return text;
              },
            },
            {},
            { repeatUntilStable: true },
          );

        // Without incremental passes the revisit line never prints, so the
        // changed count is the only convergence signal a pass leaves behind.
        const { exitCode } = await migrate({ rootDir, config, incrementalPasses: false });

        expect(exitCode).toBe(0);
        const messages = infoSpy.mock.calls.map((call) => call.join(' '));
        expect(messages.filter((message) => /\. Start\.\.\.$/.test(message))).toEqual([
          '[grow] Plugin 1 of 2. Start...',
          '[noop] Plugin 2 of 2. Start...',
          '[grow] Re-running (pass 2 of 5). Start...',
          '[noop] Re-running (pass 2 of 5). Start...',
          '[grow] Re-running (pass 3 of 5). Start...',
          '[noop] Re-running (pass 3 of 5). Start...',
        ]);
        const ordinals = messages
          .map((message) => /Plugin (\d+) of \d+\./.exec(message))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match) => Number(match[1]));
        expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
        expect(messages.filter((message) => message.startsWith('Pass '))).toEqual([
          'Pass 1 of 5 changed 1 file(s).',
          'Pass 2 of 5 changed 1 file(s).',
        ]);
        expect(messages.some((message) => message.startsWith('Next pass revisits'))).toBe(false);
      } finally {
        infoSpy.mockRestore();
      }
    }, 15000);
  });

  describe('migration set size', () => {
    const writeTsConfig = (include: string[]) =>
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, types: [] }, include }),
      );

    it('reports the count before the first plugin banner', async () => {
      copyDir(path.resolve(fixturesDir, 'tsconfig'), rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 2;\n');

      const infoSpy = jest.spyOn(log, 'info');
      try {
        const config = new MigrateConfig().addPlugin(
          { name: 'noop', run: ({ text }) => text },
          {},
        );

        const { filesToMigrate, emptyMigrationSet } = await migrate({ rootDir, config });

        expect(filesToMigrate).toBe(2);
        expect(emptyMigrationSet).toBeUndefined();
        const messages = infoSpy.mock.calls.map((call) => call.join(' '));
        const countIndex = messages.findIndex((message) => /^Migrating 2 file\(s\) in /.test(message));
        const bannerIndex = messages.findIndex((message) => message.includes('Plugin 1 of 1'));
        expect(countIndex).toBeGreaterThanOrEqual(0);
        expect(bannerIndex).toBeGreaterThan(countIndex);
      } finally {
        infoSpy.mockRestore();
      }
    });

    it('resolves with the tsconfig diagnostics when the include matches nothing', async () => {
      writeTsConfig(['**/*.ts']);
      fs.writeFileSync(path.resolve(rootDir, 'a.js'), 'export const a = 1;\n');

      const { exitCode, filesToMigrate, emptyMigrationSet } = await migrate({
        rootDir,
        config: new MigrateConfig(),
      });

      // The server reports the empty set; deciding it is a failure is the CLI's.
      expect(exitCode).toBe(0);
      expect(filesToMigrate).toBe(0);
      expect(emptyMigrationSet?.reason).toBe('tsconfig-matched-nothing');
      expect(emptyMigrationSet?.diagnostics).toEqual([
        expect.stringContaining('TS18003: No inputs were found in config file'),
      ]);
    });

    it('names the JavaScript case when the tsconfig matches only unrenamed files', async () => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { allowJs: true, strict: true, types: [] },
          include: ['**/*.js'],
        }),
      );
      fs.writeFileSync(path.resolve(rootDir, 'a.js'), 'export const a = 1;\n');

      const { filesToMigrate, emptyMigrationSet } = await migrate({
        rootDir,
        config: new MigrateConfig(),
      });

      expect(filesToMigrate).toBe(0);
      expect(emptyMigrationSet?.reason).toBe('only-javascript-files');
      // The tsconfig itself is fine here, so it contributes no diagnostic.
      expect(emptyMigrationSet?.diagnostics).toEqual([]);
    });

    it('names the sources case when the glob matches nothing', async () => {
      writeTsConfig(['**/*.ts']);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');

      const { filesToMigrate, emptyMigrationSet } = await migrate({
        rootDir,
        config: new MigrateConfig(),
        sources: 'nowhere/**/*',
      });

      expect(filesToMigrate).toBe(0);
      expect(emptyMigrationSet?.reason).toBe('sources-matched-nothing');
    });

    it('names the filter when it dropped every migratable file', async () => {
      writeTsConfig(['**/*.ts']);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');

      const { filesToMigrate, emptyMigrationSet } = await migrate({
        rootDir,
        config: new MigrateConfig(),
        filterMigrationFiles: () => [],
      });

      expect(filesToMigrate).toBe(0);
      expect(emptyMigrationSet?.reason).toBe('all-files-filtered');
    });

    it('names the declaration case when the tsconfig matches only .d.ts files', async () => {
      writeTsConfig(['**/*.d.ts']);
      fs.writeFileSync(path.resolve(rootDir, 'globals.d.ts'), 'declare const g: string;\n');
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'export const a = 1;\n');

      const { filesToMigrate, emptyMigrationSet } = await migrate({
        rootDir,
        config: new MigrateConfig(),
      });

      expect(filesToMigrate).toBe(0);
      expect(emptyMigrationSet?.reason).toBe('only-declaration-files');
    });
  });

  describe('pluginStats', () => {
    it('counts distinct changed files per plugin in pipeline order', async () => {
      const configDir = path.resolve(fixturesDir, 'tsconfig');
      copyDir(configDir, rootDir);
      fs.writeFileSync(path.resolve(rootDir, 'a.ts'), 'x');
      fs.writeFileSync(path.resolve(rootDir, 'b.ts'), 'export const b = 1;\n');

      const config = new MigrateConfig()
        .addPlugin(
          {
            name: 'grow-a',
            run({ fileName, text }) {
              return fileName.endsWith('a.ts') && text.length < 3 ? `${text}x` : text;
            },
          },
          {},
          { repeatUntilStable: true },
        )
        .addPlugin(
          {
            name: 'noop',
            run({ text }) {
              return text;
            },
          },
          {},
        );

      const { exitCode, pluginStats } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      // grow-a changed a.ts on two passes; the file counts once.
      expect(pluginStats).toEqual([
        { pluginName: 'grow-a', changedFileCount: 1 },
        { pluginName: 'noop', changedFileCount: 0 },
      ]);
    });
  });

  it('Migrates project with two plugins', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    const outputDir = path.resolve(fixturesDir, 'migrate/output-two-plugins');
    const configDir = path.resolve(fixturesDir, 'tsconfig');

    copyDir(inputDir, rootDir);
    copyDir(configDir, rootDir);

    const config = new MigrateConfig()
      .addPlugin(
        {
          name: 'test-plugin-1',
          run({ text }) {
            const newText = text.replace('test string', 'updated string');
            return newText;
          },
        },
        {},
      )
      .addPlugin(
        {
          name: 'test-plugin-2',
          run({ text }) {
            const newText = text.replace('updated string', 'another updated string');
            return newText;
          },
        },
        {},
      );

    const { exitCode } = await migrate({ rootDir, config });
    fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(exitCode).toBe(0);
  });

  describe('JavaScript files', () => {
    const jsFiles = {
      'legacy/shapes.js': "export const itemShape = { id: 1 };\n",
      'legacy/widget.jsx': 'export const Widget = () => null;\n',
      'legacy/esm.mjs': 'export const esm = 1;\n',
      'legacy/tool.cjs': 'module.exports = { tool: 1 };\n',
    };

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            allowJs: true,
            module: 'commonjs',
            target: 'es2019',
            strict: true,
            noEmit: true,
            types: [],
          },
          include: ['.'],
        }),
      );
      fs.writeFileSync(
        path.resolve(rootDir, 'app.ts'),
        "import { itemShape } from './legacy/shapes';\nexport const id: number = itemShape.id;\n",
      );
      fs.mkdirSync(path.resolve(rootDir, 'legacy'));
      Object.entries(jsFiles).forEach(([relPath, text]) => {
        fs.writeFileSync(path.resolve(rootDir, relPath), text);
      });
    });

    it('leaves every JavaScript extension out of the migration set under allowJs', async () => {
      const { config, visited } = rewritingConfig();

      const { exitCode, updatedSourceFiles } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(visited).toEqual(['app.ts']);
      expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'app.ts')]);
      Object.entries(jsFiles).forEach(([relPath, text]) => {
        expect(fs.readFileSync(path.resolve(rootDir, relPath), 'utf8')).toBe(text);
      });
    });

    it('keeps them in the program so imports of them still resolve', async () => {
      const diagnostics: number[] = [];
      let importedSourceFile: ts.SourceFile | undefined;
      const config = new MigrateConfig().addPlugin(
        {
          name: 'record-diagnostics',
          run({ fileName, getLanguageService }) {
            const languageService = getLanguageService();
            importedSourceFile = languageService
              .getProgram()
              ?.getSourceFile(path.resolve(rootDir, 'legacy/shapes.js'));
            diagnostics.push(...languageService.getSemanticDiagnostics(fileName).map((d) => d.code));
            return undefined;
          },
        },
        {},
      );

      const { exitCode } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      // The .js file still types its importer, so nothing there needs suppressing.
      expect(diagnostics).toEqual([]);
      expect(importedSourceFile).toBeDefined();
    });

    it('leaves them out of a sources-scoped run that globs them in', async () => {
      const { config, visited } = rewritingConfig();

      const { exitCode } = await migrate({ rootDir, config, sources: '**/*' });

      expect(exitCode).toBe(0);
      expect(visited).toEqual(['app.ts']);
      Object.entries(jsFiles).forEach(([relPath, text]) => {
        expect(fs.readFileSync(path.resolve(rootDir, relPath), 'utf8')).toBe(text);
      });
    });
  });

  describe('declaration files', () => {
    const declarationFiles = {
      'types/globals.d.ts': 'declare type AppString = string;\n',
      'types/globals.d.mts': 'declare type AppNumber = number;\n',
      'types/legacy.d.cts': 'declare type AppBoolean = boolean;\n',
    };
    const appText =
      "export const s: AppString = 's';\nexport const n: AppNumber = 1;\nexport const b: AppBoolean = true;\n";

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'commonjs',
            target: 'es2019',
            strict: true,
            noEmit: true,
            types: [],
          },
          include: ['.'],
        }),
      );
      fs.writeFileSync(path.resolve(rootDir, 'app.ts'), appText);
      fs.mkdirSync(path.resolve(rootDir, 'types'));
      Object.entries(declarationFiles).forEach(([relPath, text]) => {
        fs.writeFileSync(path.resolve(rootDir, relPath), text);
      });
    });

    it('leaves every declaration file extension out of the migration set', async () => {
      const { config, visited } = rewritingConfig();

      const { exitCode, updatedSourceFiles } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(visited).toEqual(['app.ts']);
      expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'app.ts')]);
      Object.entries(declarationFiles).forEach(([relPath, text]) => {
        expect(fs.readFileSync(path.resolve(rootDir, relPath), 'utf8')).toBe(text);
      });
    });

    it('leaves them out of a sources-scoped run that globs them in', async () => {
      const { config, visited } = rewritingConfig();

      const { exitCode } = await migrate({ rootDir, config, sources: '**/*' });

      expect(exitCode).toBe(0);
      expect(visited).toEqual(['app.ts']);
      Object.entries(declarationFiles).forEach(([relPath, text]) => {
        expect(fs.readFileSync(path.resolve(rootDir, relPath), 'utf8')).toBe(text);
      });
    });

    it('retains every declaration file extension as an ambient source', async () => {
      const diagnostics: number[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'record-diagnostics',
          run({ fileName, getLanguageService }) {
            diagnostics.push(
              ...getLanguageService()
                .getSemanticDiagnostics(fileName)
                .map((diagnostic) => diagnostic.code),
            );
            return undefined;
          },
        },
        {},
      );

      const { exitCode } = await migrate({ rootDir, config, sources: 'app.ts' });

      expect(exitCode).toBe(0);
      // Every global the .d.ts, .d.mts and .d.cts files declare still resolves.
      expect(diagnostics).toEqual([]);
    });
  });

  describe('filterMigrationFiles', () => {
    it('keeps filtered files out of the migration and the program, except as dependencies', async () => {
      const writeFile = (relPath: string, text: string) =>
        fs.writeFileSync(path.resolve(rootDir, relPath), text);
      writeFile(
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, module: 'commonjs', target: 'es2019' },
          include: ['./**/*'],
        }),
      );
      writeFile('globals.d.ts', 'declare type AppGlobal = string;\n');
      writeFile('app.ts', "import { gen } from './generated';\nconst x: AppGlobal = gen;\nexport default x;\n");
      writeFile('generated.ts', "export const gen = 'g';\n");
      writeFile('unreferenced.ts', 'export const unused = 1;\n');

      const filterReceived: string[][] = [];
      const visited: string[] = [];
      let importedSourceFile: unknown;
      let unreferencedSourceFile: unknown;
      let appDiagnostics: unknown[] = [];
      const config = new MigrateConfig().addPlugin(
        {
          name: 'recording-plugin',
          run({ fileName, getLanguageService }) {
            visited.push(path.basename(fileName));
            const program = getLanguageService().getProgram()!;
            importedSourceFile = program.getSourceFile(path.resolve(rootDir, 'generated.ts'));
            unreferencedSourceFile = program.getSourceFile(path.resolve(rootDir, 'unreferenced.ts'));
            appDiagnostics = getLanguageService().getSemanticDiagnostics(fileName);
            return undefined;
          },
        },
        {},
      );

      const { exitCode } = await migrate({
        rootDir,
        config,
        filterMigrationFiles: (fileNames) => {
          filterReceived.push(fileNames.map((fileName) => path.basename(fileName)));
          return fileNames.filter(
            (fileName) => !/generated\.ts$|unreferenced\.ts$/.test(fileName),
          );
        },
      });

      expect(exitCode).toBe(0);
      // The filter sees every non-declaration root exactly once.
      expect(filterReceived).toHaveLength(1);
      expect(filterReceived[0].sort()).toEqual(['app.ts', 'generated.ts', 'unreferenced.ts']);
      // Only the kept file is migrated.
      expect(visited).toEqual(['app.ts']);
      // A dropped file that a kept file imports is still resolvable...
      expect(importedSourceFile).toBeDefined();
      expect(appDiagnostics).toEqual([]);
      // ...while a dropped, unreferenced file is never parsed into the program.
      expect(unreferencedSourceFile).toBeUndefined();
    });
  });
});
