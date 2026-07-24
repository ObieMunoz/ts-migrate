import path from 'path';
import fs from 'fs';
import log from 'updatable-log';
import { createDir, copyDir, deleteDir, getDirData, hashDir } from '../../test-utils';
import migrate, { MigrateConfig } from '../../../src/migrate';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../../test-utils');
  return mockUpdatableLog();
});

describe('migrate command', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('Migrates project', async () => {
    const inputDir = path.resolve(__dirname, 'input');
    const outputDir = path.resolve(__dirname, 'output');
    const configDir = path.resolve(__dirname, 'config');

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
      const inputDir = path.resolve(__dirname, 'input');
      const configDir = path.resolve(__dirname, 'config');
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

  describe('sources', () => {
    it('Migrates project by using `sources`', async () => {
      const inputDir = path.resolve(__dirname, 'input');
      const outputDir = path.resolve(__dirname, 'output');
      const configDir = path.resolve(__dirname, 'config');

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
      const inputDir = path.resolve(__dirname, 'input');
      const outputDir = path.resolve(__dirname, 'output');
      const configDir = path.resolve(__dirname, 'config');

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
    const configDir = path.resolve(__dirname, 'config');
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

    const { exitCode } = await migrate({ rootDir, config });
    expect(exitCode).not.toBe(0);
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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

    it('revisits every file when a changed file affects the global scope', async () => {
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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
      const configDir = path.resolve(__dirname, 'config');
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

  describe('pluginStats', () => {
    it('counts distinct changed files per plugin in pipeline order', async () => {
      const configDir = path.resolve(__dirname, 'config');
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
    const inputDir = path.resolve(__dirname, 'input');
    const outputDir = path.resolve(__dirname, 'output_two');
    const configDir = path.resolve(__dirname, 'config');

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
});
