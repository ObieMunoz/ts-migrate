import path from 'path';
import { mockPluginParams } from '../test-utils';
import updateImportPathsPlugin from '../../src/plugins/update-import-paths';

const fixturesDir = path.resolve(__dirname, '../fixtures/update-import-paths');
const entryFile = path.join(fixturesDir, 'src', 'entry.ts');
const mtsEntryFile = path.join(fixturesDir, 'src', 'entry.mts');
const esmEntryFile = path.join(fixturesDir, 'esm', 'src', 'entry.ts');

describe('update-import-paths plugin', () => {
  it('rewrites specifiers of renamed files across module syntaxes', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
import Chart from './Chart.js';
import { helper } from './utils/helpers.js';
import shared from '../shared.js';
export { foo2 } from './foo.js';
export * from './foo.js';
import fooEquals = require('./foo.js');
type FooModule = typeof import('./foo.js');
const lazy = () => import('./foo.js');
const required = require('./foo.js');
const resolved = require.resolve('./foo.js');
jest.mock('./foo.js');
jest.requireActual('./Widget.jsx');
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(`import foo from './foo';
import Widget from './Widget';
import Chart from './Chart';
import { helper } from './utils/helpers';
import shared from '../shared';
export { foo2 } from './foo';
export * from './foo';
import fooEquals = require('./foo');
type FooModule = typeof import('./foo');
const lazy = () => import('./foo');
const required = require('./foo');
const resolved = require.resolve('./foo');
jest.mock('./foo');
jest.requireActual('./Widget');
`);
  });

  it('leaves valid and unrelated specifiers alone', async () => {
    const text = `import legacy from './legacy.js';
import React from 'react';
import missing from './missing.js';
import styles from './styles.css';
import foo from './foo';
import weird from './.js';
const notAModule = './foo.js';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(text);
  });

  it('keeps a .js extension with the extension option', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile, options: { extension: 'js' } }),
    );

    expect(result).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);
  });

  it('leaves .mjs and .cjs specifiers of renamed files alone', async () => {
    const text = `import task from './task.mjs';
import helper from './helper.cjs';
const lazy = () => import('./task.mjs');
const required = require('./helper.cjs');
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(text);
  });

  it('keeps a .js extension in a .mts file outside an ESM package', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: mtsEntryFile }),
    );

    expect(result).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);
  });

  it('keeps a .js extension in an ESM package', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: esmEntryFile }),
    );

    expect(result).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);
  });

  it('validates options', () => {
    const { validate } = updateImportPathsPlugin;
    if (!validate) throw new Error('expected validate to be defined');
    expect(validate({})).toBe(true);
    expect(validate({ extension: 'omit' })).toBe(true);
    expect(validate({ extension: 'js' })).toBe(true);
    expect(() => validate({ extension: 'ts' })).toThrow();
    expect(() => validate({ badOption: true })).toThrow();
  });
});
