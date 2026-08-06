import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  createTypesPackageDetector,
  tsIgnorePlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  inferTypesPlugin,
  updateImportPathsPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import init from '../../../commands/init';
import buildMigrateConfig from '../../../commands/migrate';
import { createGitignoreMigrationFilter } from '../../../utils/gitignore';
import { createDir, copyDir, deleteDir, getDirData } from '@obiemunoz/ts-migrate-test-utils';

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

  it('Migrates project', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    const outputDir = path.resolve(fixturesDir, 'migrate/output');
    copyDir(inputDir, rootDir);
    const config = new MigrateConfig()
      .addPlugin(explicitAnyPlugin, { anyAlias: '$TSFixMe' })
      .addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' })
      .addPlugin(eslintFixPlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(exitCode).toBe(0);
  });

  it('annotates implicit anys that only surface after an earlier annotation', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    copyDir(inputDir, rootDir);
    // `h` only becomes an implicit any once `handlers` is annotated `any`, so
    // a single pass would leave it for ts-ignore to suppress.
    fs.writeFileSync(
      path.resolve(rootDir, 'file-1.ts'),
      `const handlers = [];
handlers.map(h => h.onReady);
`,
    );
    fs.unlinkSync(path.resolve(rootDir, 'Foo.tsx'));

    const config = new MigrateConfig()
      .addPlugin(inferTypesPlugin, {}, { repeatUntilStable: true })
      .addPlugin(explicitAnyPlugin, {}, { repeatUntilStable: true })
      .addPlugin(tsIgnorePlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    expect(fs.readFileSync(path.resolve(rootDir, 'file-1.ts'), 'utf8')).toBe(
      `const handlers: any = [];
handlers.map((h: { onReady: any; }) => h.onReady);
`,
    );
    expect(exitCode).toBe(0);
  });

  it('re-points imports of renamed files', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    copyDir(inputDir, rootDir);
    fs.writeFileSync(path.resolve(rootDir, 'util.ts'), `export const util = 1;\n`);
    fs.writeFileSync(
      path.resolve(rootDir, 'file-1.ts'),
      `import { util } from './util.js';

export const value = util;
`,
    );

    const config = new MigrateConfig().addPlugin(updateImportPathsPlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    expect(fs.readFileSync(path.resolve(rootDir, 'file-1.ts'), 'utf8')).toBe(
      `import { util } from './util';

export const value = util;
`,
    );
    expect(exitCode).toBe(0);
  });

  it('strips an import path that names a TypeScript file instead of suppressing it', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    copyDir(inputDir, rootDir);
    fs.writeFileSync(path.resolve(rootDir, 'util.ts'), `export const util = 1;\n`);
    // TS5097: legal for the bundler that resolved it before the migration, an
    // error for tsc, and left for ts-ignore to suppress without this pass.
    fs.writeFileSync(
      path.resolve(rootDir, 'file-1.ts'),
      `import { util } from './util.ts';

export const value = util;
`,
    );

    const config = new MigrateConfig()
      .addPlugin(updateImportPathsPlugin, {})
      .addPlugin(tsIgnorePlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    expect(fs.readFileSync(path.resolve(rootDir, 'file-1.ts'), 'utf8')).toBe(
      `import { util } from './util';

export const value = util;
`,
    );
    expect(exitCode).toBe(0);
  });

  describe('sources-scoped migration with ambient declaration files', () => {
    const sourceText = 'export const version: string = __APP_VERSION__;\n';

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
      );
      fs.writeFileSync(
        path.resolve(rootDir, 'vite-env.d.ts'),
        'declare const __APP_VERSION__: string;\n',
      );
      fs.mkdirSync(path.resolve(rootDir, 'feature'));
      fs.writeFileSync(path.resolve(rootDir, 'feature/index.ts'), sourceText);
    });

    it('adds no suppressions for globals the retained ambient files declare', async () => {
      const config = new MigrateConfig().addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });

      const { exitCode } = await migrate({ rootDir, config, sources: 'feature/**/*' });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(rootDir, 'feature/index.ts'), 'utf8')).toBe(sourceText);
    });

    it('suppresses the now-unresolvable global with ambientSources disabled', async () => {
      const config = new MigrateConfig().addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });

      const { exitCode } = await migrate({
        rootDir,
        config,
        sources: 'feature/**/*',
        ambientSources: false,
      });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(rootDir, 'feature/index.ts'), 'utf8')).toMatch(
        /@ts-expect-error TS\(2304\) FIXME/,
      );
    });
  });

  it('converts imported propTypes to a structural props type', async () => {
    const inputDir = path.resolve(fixturesDir, 'migrate/input');
    copyDir(inputDir, rootDir);
    fs.unlinkSync(path.resolve(rootDir, 'Foo.tsx'));
    fs.unlinkSync(path.resolve(rootDir, 'file-1.ts'));
    fs.writeFileSync(
      path.resolve(rootDir, 'messagePropTypes.ts'),
      `import PropTypes from 'prop-types';

export const messagePropTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};
`,
    );
    fs.writeFileSync(
      path.resolve(rootDir, 'MessageList.tsx'),
      `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => <div>{props.title}</div>;

MessageList.propTypes = messagePropTypes;

export default MessageList;
`,
    );
    // A second consumer of the same module: the inliner reuses one program
    // snapshot for the whole pass, so this file is processed after the first
    // consumer was already edited.
    fs.writeFileSync(
      path.resolve(rootDir, 'MessageHeader.tsx'),
      `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageHeader = (props) => <h1>{props.title}</h1>;

MessageHeader.propTypes = messagePropTypes;

export default MessageHeader;
`,
    );

    const config = new MigrateConfig()
      .addPlugin(reactInlineImportedPropTypesPlugin, {})
      .addPlugin(reactPropsPlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    expect(fs.readFileSync(path.resolve(rootDir, 'MessageList.tsx'), 'utf8')).toBe(
      `import React from 'react';

type Props = {
    messages: string[];
    title?: string;
};

const MessageList = (props: Props) => <div>{props.title}</div>;

export default MessageList;
`,
    );
    expect(fs.readFileSync(path.resolve(rootDir, 'MessageHeader.tsx'), 'utf8')).toBe(
      `import React from 'react';

type Props = {
    messages: string[];
    title?: string;
};

const MessageHeader = (props: Props) => <h1>{props.title}</h1>;

export default MessageHeader;
`,
    );
    expect(fs.readFileSync(path.resolve(rootDir, 'messagePropTypes.ts'), 'utf8')).toBe(
      `import PropTypes from 'prop-types';

export const messagePropTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};
`,
    );
    expect(exitCode).toBe(0);
  });

  it('skips gitignored files via the gitignore migration filter', async () => {
    execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
    fs.writeFileSync(
      path.resolve(rootDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['.'] }),
    );
    fs.writeFileSync(path.resolve(rootDir, '.gitignore'), 'dist/\n');
    fs.writeFileSync(path.resolve(rootDir, 'app.ts'), "const broken: number = 'oops';\n");
    fs.mkdirSync(path.resolve(rootDir, 'dist'));
    const bundleText = "const bundled: number = 'oops';\n";
    fs.writeFileSync(path.resolve(rootDir, 'dist/bundle.ts'), bundleText);

    // Composed the same way the migrate command wires it up.
    const gitignoreFilter = createGitignoreMigrationFilter(rootDir);
    const config = new MigrateConfig().addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });
    const { exitCode, updatedSourceFiles } = await migrate({
      rootDir,
      config,
      filterMigrationFiles: gitignoreFilter.filterMigrationFiles,
    });

    expect(exitCode).toBe(0);
    expect(gitignoreFilter.skippedFiles()).toEqual([path.resolve(rootDir, 'dist/bundle.ts')]);
    expect([...updatedSourceFiles]).toEqual([path.resolve(rootDir, 'app.ts')]);
    expect(fs.readFileSync(path.resolve(rootDir, 'app.ts'), 'utf8')).toMatch(
      /@ts-expect-error TS\(2322\) FIXME/,
    );
    expect(fs.readFileSync(path.resolve(rootDir, 'dist/bundle.ts'), 'utf8')).toBe(bundleText);
  });

  describe('imports of a package that ships no type definitions', () => {
    const sourceText = "import untyped from 'untyped-lib';\n\nexport const value = untyped;\n";
    const declarationsFile = 'types/ts-migrate-modules.d.ts';

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'commonjs',
            noEmit: true,
            strict: true,
            esModuleInterop: true,
            types: [],
          },
          include: ['.'],
        }),
      );
      fs.mkdirSync(path.resolve(rootDir, 'node_modules/untyped-lib'), { recursive: true });
      fs.writeFileSync(
        path.resolve(rootDir, 'node_modules/untyped-lib/package.json'),
        JSON.stringify({ name: 'untyped-lib', version: '1.0.0', main: 'index.js' }),
      );
      fs.writeFileSync(
        path.resolve(rootDir, 'node_modules/untyped-lib/index.js'),
        'module.exports = {};\n',
      );
      fs.writeFileSync(path.resolve(rootDir, 'app.ts'), sourceText);
    });

    // Composed the way the migrate command wires the detector up.
    const configWith = (detector: TypesPackageDetector, declare: boolean) => {
      const config = new MigrateConfig().addPlugin(detector.plugin, {});
      if (declare) config.addPlugin(detector.declarationsPlugin, {});
      return config.addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });
    };

    it('declares the module instead of suppressing its imports', async () => {
      const detector = createTypesPackageDetector();

      const { exitCode, generatedFiles } = await migrate({
        rootDir,
        config: configWith(detector, true),
      });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(rootDir, declarationsFile), 'utf8')).toContain(
        "declare module 'untyped-lib';",
      );
      expect([...generatedFiles.keys()]).toEqual([path.resolve(rootDir, declarationsFile)]);
      expect(fs.readFileSync(path.resolve(rootDir, 'app.ts'), 'utf8')).toBe(sourceText);
      expect(detector.summarize(rootDir).declared?.moduleNames).toEqual(['untyped-lib']);
    });

    it('suppresses the import when the declarations are turned off', async () => {
      const detector = createTypesPackageDetector();

      const { exitCode, generatedFiles } = await migrate({
        rootDir,
        config: configWith(detector, false),
      });

      expect(exitCode).toBe(0);
      expect(generatedFiles.size).toBe(0);
      expect(fs.existsSync(path.resolve(rootDir, declarationsFile))).toBe(false);
      expect(fs.readFileSync(path.resolve(rootDir, 'app.ts'), 'utf8')).toMatch(
        /@ts-expect-error TS\(7016\) FIXME/,
      );
    });
  });

  describe('a project whose tsconfig sets allowJs', () => {
    const shapesText = `import PropTypes from 'prop-types';

export const itemShape = PropTypes.shape({
  id: PropTypes.number.isRequired,
  label: PropTypes.string,
});
`;
    const featureText = `import { itemShape } from '../legacy/shapes';

export const shape = itemShape;
`;

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            allowJs: true,
            allowSyntheticDefaultImports: true,
            module: 'commonjs',
            target: 'es2019',
            noEmit: true,
            strict: true,
            types: [],
          },
          include: ['.'],
        }),
      );
      fs.mkdirSync(path.resolve(rootDir, 'legacy'));
      fs.writeFileSync(path.resolve(rootDir, 'legacy/shapes.js'), shapesText);
      fs.mkdirSync(path.resolve(rootDir, 'feature'));
      fs.writeFileSync(path.resolve(rootDir, 'feature/index.ts'), featureText);
    });

    it('runs the default pipeline without writing TypeScript into the .js file', async () => {
      const { config } = buildMigrateConfig({ inferTypes: false });

      const { exitCode, updatedSourceFiles } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(rootDir, 'legacy/shapes.js'), 'utf8')).toBe(shapesText);
      expect([...updatedSourceFiles]).not.toContain(path.resolve(rootDir, 'legacy/shapes.js'));
    }, 30000);
  });

  describe('a project whose tsconfig includes .d.mts and .d.cts files', () => {
    // Implicit anys and an unresolvable type: the annotation and suppression
    // plugins both have something to write here.
    const declarationFiles = {
      'types/globals.d.mts': 'declare function widen(value): void;\n',
      'types/legacy.d.cts': 'declare function narrow(value): Unresolvable;\n',
    };
    const appText = 'export function app(value: string) {\n  return value;\n}\n';

    beforeEach(() => {
      fs.writeFileSync(
        path.resolve(rootDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'commonjs',
            target: 'es2019',
            noEmit: true,
            strict: true,
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

    it('runs the default pipeline without writing into the declaration files', async () => {
      const { config } = buildMigrateConfig({ inferTypes: false });

      const { exitCode, updatedSourceFiles } = await migrate({ rootDir, config });

      expect(exitCode).toBe(0);
      Object.entries(declarationFiles).forEach(([relPath, text]) => {
        const fileName = path.resolve(rootDir, relPath);
        expect(fs.readFileSync(fileName, 'utf8')).toBe(text);
        expect([...updatedSourceFiles]).not.toContain(fileName);
      });
    }, 30000);
  });

  describe('under the tsconfig init generates', () => {
    // An OS temp dir rather than one inside this repo: init scans the project
    // directory and its ancestors for node_modules/@types, and the workspace's
    // own @types packages would leak into the generated config.
    let projectDir: string;

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-generated-'));
    });

    afterEach(() => {
      deleteDir(projectDir);
    });

    it('types a JSON import instead of suppressing it', async () => {
      fs.writeFileSync(
        path.resolve(projectDir, 'config.json'),
        JSON.stringify({ retries: 3 }, null, 2),
      );
      const sourceText = `import config from './config.json';

export const retries: number = config.retries;
`;
      fs.writeFileSync(path.resolve(projectDir, 'app.ts'), sourceText);
      init({ rootDir: projectDir, isExtendedConfig: false });

      const config = new MigrateConfig().addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });
      const { exitCode } = await migrate({ rootDir: projectDir, config });

      expect(exitCode).toBe(0);
      expect(fs.readFileSync(path.resolve(projectDir, 'app.ts'), 'utf8')).toBe(sourceText);
    });

    describe('with JavaScript the migration has not reached yet', () => {
      const utilText = 'export const util = { n: 1 };\n';
      const featureText = `import { util } from '../legacy/util';

export const n: number = util.n;
`;

      beforeEach(() => {
        fs.mkdirSync(path.resolve(projectDir, 'legacy'));
        fs.writeFileSync(path.resolve(projectDir, 'legacy/util.js'), utilText);
        fs.mkdirSync(path.resolve(projectDir, 'feature'));
        fs.writeFileSync(path.resolve(projectDir, 'feature/index.ts'), featureText);
        init({ rootDir: projectDir, isExtendedConfig: false });
      });

      it('resolves a staged migration\'s imports into it instead of suppressing them', async () => {
        const config = new MigrateConfig().addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' });

        const { exitCode } = await migrate({
          rootDir: projectDir,
          config,
          sources: 'feature/**/*',
        });

        expect(exitCode).toBe(0);
        expect(fs.readFileSync(path.resolve(projectDir, 'feature/index.ts'), 'utf8')).toBe(
          featureText,
        );
      });

      it('leaves it untouched on a full run', async () => {
        const { config } = buildMigrateConfig({ inferTypes: false });

        const { exitCode } = await migrate({ rootDir: projectDir, config });

        expect(exitCode).toBe(0);
        expect(fs.readFileSync(path.resolve(projectDir, 'legacy/util.js'), 'utf8')).toBe(utilText);
      }, 30000);
    });
  });
});
