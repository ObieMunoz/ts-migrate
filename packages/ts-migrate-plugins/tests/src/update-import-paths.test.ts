import path from 'path';
import ts from 'typescript';
import { mockPluginParams } from '../test-utils';
import updateImportPathsPlugin from '../../src/plugins/update-import-paths';

const fixturesDir = path.resolve(__dirname, '../fixtures/update-import-paths');
const entryFile = path.join(fixturesDir, 'src', 'entry.ts');
const mtsEntryFile = path.join(fixturesDir, 'src', 'entry.mts');
const esmEntryFile = path.join(fixturesDir, 'esm', 'src', 'entry.ts');
const esmMtsEntryFile = path.join(fixturesDir, 'esm', 'src', 'entry.mts');
const esmCtsEntryFile = path.join(fixturesDir, 'esm', 'src', 'entry.cts');
const esmCjsEntryFile = path.join(fixturesDir, 'esm', 'src', 'entry.cjs');

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

  it('drops a .ts/.tsx extension across module syntaxes', async () => {
    const text = `import foo from './foo.ts';
import Widget from './Widget.tsx';
import { helper } from './utils/helpers.ts';
import shared from '../shared.ts';
export { foo2 } from './foo.ts';
export * from './foo.ts';
import fooEquals = require('./foo.ts');
type FooModule = typeof import('./foo.ts');
const lazy = () => import('./foo.ts');
const resolved = require.resolve('./foo.ts');
jest.mock('./foo.ts');
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(`import foo from './foo';
import Widget from './Widget';
import { helper } from './utils/helpers';
import shared from '../shared';
export { foo2 } from './foo';
export * from './foo';
import fooEquals = require('./foo');
type FooModule = typeof import('./foo');
const lazy = () => import('./foo');
const resolved = require.resolve('./foo');
jest.mock('./foo');
`);
  });

  it('keeps a .js extension on a .ts/.tsx specifier in an ESM package', async () => {
    const text = `import foo from './foo.ts';
import Widget from './Widget.tsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: esmEntryFile }),
    );

    expect(result).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);
  });

  it('rewrites a .mts/.cts specifier to the extension it emits', async () => {
    const text = `import task from './task.mts';
const helper = require('./helper.cts');
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(`import task from './task.mjs';
const helper = require('./helper.cjs');
`);
  });

  it('leaves a .ts specifier alone where another file shares its base', async () => {
    // both.ts sits beside a both.js, so './both' names one of two files;
    // missing.ts is not there to be named under any extension; and types.d.ts
    // is emitted under no other extension, so './types.d' names nothing.
    const text = `import both from './both.ts';
import missing from './missing.ts';
import type { Shape } from './types.d.ts';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: entryFile }),
    );

    expect(result).toBe(text);
  });

  it('leaves a .ts specifier alone with allowImportingTsExtensions', async () => {
    // The project writes the extension on purpose, so only the stale .js one,
    // which TypeScript still resolves past, is rewritten.
    const text = `import foo from './foo.ts';
import Chart from './Chart.js';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({
        text,
        fileName: entryFile,
        compilerOptions: { allowImportingTsExtensions: true, noEmit: true },
      }),
    );

    expect(result).toBe(`import foo from './foo.ts';
import Chart from './Chart';
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

  it('drops the extension in a .cts file in an ESM package', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: esmCtsEntryFile }),
    );

    expect(result).toBe(`import foo from './foo';
import Widget from './Widget';
`);
  });

  it('drops the extension in a .cjs file in an ESM package', async () => {
    const text = `const foo = require('./foo.js');
const Widget = require('./Widget.jsx');
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: esmCjsEntryFile }),
    );

    expect(result).toBe(`const foo = require('./foo');
const Widget = require('./Widget');
`);
  });

  it('keeps a .js extension in a .mts file in an ESM package', async () => {
    const text = `import foo from './foo.js';
import Widget from './Widget.jsx';
`;

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text, fileName: esmMtsEntryFile }),
    );

    expect(result).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);
  });

  it('drops a .js extension an earlier run left in a .cts file', async () => {
    const earlier = await updateImportPathsPlugin.run(
      mockPluginParams({
        text: `import foo from './foo.js';
import Widget from './Widget.jsx';
`,
        fileName: esmCtsEntryFile,
        options: { extension: 'js' },
      }),
    );
    expect(earlier).toBe(`import foo from './foo.js';
import Widget from './Widget.js';
`);

    const result = await updateImportPathsPlugin.run(
      mockPluginParams({ text: earlier, fileName: esmCtsEntryFile }),
    );
    expect(result).toBe(`import foo from './foo';
import Widget from './Widget';
`);

    const rerun = await updateImportPathsPlugin.run(
      mockPluginParams({ text: result, fileName: esmCtsEntryFile }),
    );
    expect(rerun).toBe(result);
  });

  describe('absolute specifiers the project maps through paths', () => {
    // What init writes for a project whose bundler resolves absolute imports
    // from a source root, parsed the way the runner parses the real tsconfig so
    // the `paths` values are read from the same place.
    const aliasOptions = (overrides: object = {}) =>
      ts.parseJsonConfigFileContent(
        {
          compilerOptions: {
            module: 'esnext',
            moduleResolution: 'bundler',
            allowJs: true,
            paths: { '*': ['./src/*'] },
            ...overrides,
          },
        },
        ts.sys,
        fixturesDir,
      ).options;

    it('rewrites a specifier of a renamed file across module syntaxes', async () => {
      const text = `import foo from 'foo.js';
import Widget from 'Widget.jsx';
import { helper } from 'utils/helpers.js';
export { foo2 } from 'foo.js';
const lazy = () => import('foo.js');
const required = require('foo.js');
jest.mock('foo.js');
`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({ text, fileName: entryFile, compilerOptions: aliasOptions() }),
      );

      expect(result).toBe(`import foo from 'foo';
import Widget from 'Widget';
import { helper } from 'utils/helpers';
export { foo2 } from 'foo';
const lazy = () => import('foo');
const required = require('foo');
jest.mock('foo');
`);
    });

    it('keeps a .js extension with the extension option', async () => {
      const result = await updateImportPathsPlugin.run(
        mockPluginParams({
          text: `import Widget from 'Widget.jsx';\n`,
          fileName: entryFile,
          options: { extension: 'js' },
          compilerOptions: aliasOptions(),
        }),
      );

      expect(result).toBe(`import Widget from 'Widget.js';\n`);
    });

    it('drops a .ts/.tsx extension the project resolves', async () => {
      const text = `import foo from 'foo.ts';
import Widget from 'Widget.tsx';
import { helper } from 'utils/helpers.ts';
const lazy = () => import('foo.ts');
jest.mock('foo.ts');
`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({ text, fileName: entryFile, compilerOptions: aliasOptions() }),
      );

      expect(result).toBe(`import foo from 'foo';
import Widget from 'Widget';
import { helper } from 'utils/helpers';
const lazy = () => import('foo');
jest.mock('foo');
`);
    });

    it('leaves a .ts specifier alone where another file shares its base', async () => {
      // both.ts sits beside a both.js, so 'both' names one of two files.
      const text = `import both from 'both.ts';\n`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({ text, fileName: entryFile, compilerOptions: aliasOptions() }),
      );

      expect(result).toBe(text);
    });

    it('leaves a specifier whose own file is still there alone', async () => {
      // legacy.js was never renamed, and both.js sits beside a both.ts that
      // the compiler substitutes to only because this project has no allowJs.
      const text = `import legacy from 'legacy.js';
import both from 'both.js';
`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({
          text,
          fileName: entryFile,
          compilerOptions: aliasOptions({ allowJs: false }),
        }),
      );

      expect(result).toBe(text);
    });

    it('leaves a package and an unresolvable specifier alone', async () => {
      const text = `import ts from 'typescript';
import shim from 'core-js/modules/es.array.flat.js';
import nothing from 'not/a/module.js';
import styles from 'theme/colors.css';
`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({ text, fileName: entryFile, compilerOptions: aliasOptions() }),
      );

      expect(result).toBe(text);
    });

    it('leaves a specifier a paths pattern names the extension of alone', async () => {
      // Dropping the extension here resolves to nothing, so the rewrite that
      // would break the build is the one that has to be declined.
      const result = await updateImportPathsPlugin.run(
        mockPluginParams({
          text: `import foo from 'legacy.js';\n`,
          fileName: entryFile,
          compilerOptions: aliasOptions({ paths: { 'legacy.js': ['./src/foo.ts'] } }),
        }),
      );

      expect(result).toBe(`import foo from 'legacy.js';\n`);
    });

    it('leaves absolute specifiers alone without project resolution', async () => {
      const text = `import foo from 'foo.js';\n`;

      const result = await updateImportPathsPlugin.run(
        mockPluginParams({ text, fileName: entryFile }),
      );

      expect(result).toBe(text);
    });
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
