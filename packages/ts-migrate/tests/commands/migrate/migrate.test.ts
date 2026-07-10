import path from 'path';
import fs from 'fs';
// eslint-disable-next-line import/no-extraneous-dependencies
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
});
