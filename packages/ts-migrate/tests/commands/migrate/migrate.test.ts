import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  tsIgnorePlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  inferTypesPlugin,
  updateImportPathsPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
} from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';
import { createGitignoreMigrationFilter } from '../../../utils/gitignore';
import { createDir, copyDir, deleteDir, getDirData } from '../../test-utils';

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
    copyDir(inputDir, rootDir);
    const config = new MigrateConfig()
      .addPlugin(explicitAnyPlugin, { anyAlias: '$TSFixMe' })
      .addPlugin(tsIgnorePlugin, { messagePrefix: 'FIXME' })
      .addPlugin(eslintFixPlugin, {});

    const { exitCode } = await migrate({ rootDir, config });
    const [rootData, outputData] = getDirData(rootDir, outputDir);
    expect(rootData).toEqual(outputData);
    expect(exitCode).toBe(0);
  }, 10000);

  it('annotates implicit anys that only surface after an earlier annotation', async () => {
    const inputDir = path.resolve(__dirname, 'input');
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
  }, 10000);

  it('re-points imports of renamed files', async () => {
    const inputDir = path.resolve(__dirname, 'input');
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
  }, 10000);

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
    }, 10000);

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
    }, 10000);
  });

  it('converts imported propTypes to a structural props type', async () => {
    const inputDir = path.resolve(__dirname, 'input');
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
  }, 10000);

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
  }, 10000);
});
