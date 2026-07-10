import path from 'path';
import fs from 'fs';
import { createDir, copyDir, deleteDir, getDirData } from '../../test-utils';
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

    const { exitCode } = await migrate({ rootDir, config });
    fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(exitCode).toBe(0);
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
