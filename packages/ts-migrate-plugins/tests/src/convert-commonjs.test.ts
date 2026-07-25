import path from 'path';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { mockPluginParams, withoutMarkers } from '../test-utils';
import convertCommonjsPlugin from '../../src/plugins/convert-commonjs';

const fixturesDir = path.resolve(__dirname, '../fixtures/convert-commonjs');
const cjsFile = path.join(fixturesDir, 'src', 'entry.ts');
const mtsFile = path.join(fixturesDir, 'src', 'entry.mts');
const esmFile = path.join(fixturesDir, 'esm', 'src', 'entry.ts');

function run(text: string, over: { fileName?: string; options?: { esm?: boolean } } = {}) {
  return convertCommonjsPlugin.run(
    mockPluginParams({ text, fileName: over.fileName ?? cjsFile, options: over.options ?? {} }),
  );
}

function runWithNotices(text: string, fileName = cjsFile) {
  const notices: PluginFileNotice[] = [];
  const result = convertCommonjsPlugin.run(
    mockPluginParams({
      text,
      fileName,
      options: {},
      reportFileNotice: (notice) => notices.push(notice),
    }),
  );
  return { result, notices };
}

describe('convert-commonjs plugin', () => {
  it('converts top level requires to the interop import forms', async () => {
    const text = `const path = require('path');
const { join, resolve: res } = require("path");
const a = require('./a'), b = require('./b');
require('./setup');
`;

    expect(await run(text)).toBe(`import path = require('path');
import { join, resolve as res } from "path";
import a = require('./a');
import b = require('./b');
import './setup';
`);
  });

  it('converts var and let requires the file never reassigns', async () => {
    const text = `var stable = require('./stable');
let reassigned = require('./reassigned');
reassigned = null;
`;

    expect(await run(text)).toBe(`import stable = require('./stable');
let reassigned = require('./reassigned');
reassigned = null;
`);
  });

  it('leaves dynamic and non-top-level requires alone', async () => {
    const text = `function load(name) {
  return require(name);
}
if (flag) {
  const extra = require('./extra');
}
const lazy = () => require('./lazy');
const partial = require('./partial').foo;
const resolved = require.resolve('./m');
const mixed = require('./mixed'), plain = 1;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves requires alone when the file binds its own require', async () => {
    const text = `const require = createRequire(import.meta.url);
const fs = require('fs');
`;

    expect(await run(text)).toBe(text);
  });

  it('converts module.exports of a named function to a declaration and export =', async () => {
    const text = `/** Runs it. */
module.exports = function run(value) {
  return value;
};
`;

    expect(await run(text)).toBe(`/** Runs it. */
function run(value) {
  return value;
}
export = run;
`);
  });

  it('converts module.exports of a named class to a declaration and export =', async () => {
    const text = `module.exports = class Widget {
  render() {}
};
`;

    expect(await run(text)).toBe(`class Widget {
  render() {}
}
export = Widget;
`);
  });

  it('converts other whole module.exports values to export =', async () => {
    const text = `function run() {}
module.exports = run;
`;

    expect(await run(text)).toBe(`function run() {}
export = run;
`);
  });

  it('names the module a barrel re-exports', async () => {
    expect(await run("module.exports = require('./lib/retry');\n")).toBe(
      "import retry = require('./lib/retry');\nexport = retry;\n",
    );
    expect(await run("module.exports = require('safe-buffer');\n")).toBe(
      "import safeBuffer = require('safe-buffer');\nexport = safeBuffer;\n",
    );
    expect(await run("module.exports = require('./lib/retry');\n", { options: { esm: true } })).toBe(
      "import retry from './lib/retry';\nexport default retry;\n",
    );
  });

  it('keeps the require when the barrel name is already used', async () => {
    const text = `const retry = 1;
module.exports = require('./retry');
`;

    expect(await run(text)).toBe(`const retry = 1;
export = require('./retry');
`);
  });

  it('converts a statically named module.exports object to named exports', async () => {
    const text = `const version = '1';
function run() {}
module.exports = { run, alias: run, version, count: 2 + 3 };
`;

    expect(await run(text)).toBe(`const version = '1';
function run() {}
export const count = 2 + 3;
export { run, run as alias, version };
`);
  });

  it('keeps export = for a module.exports object it cannot name statically', async () => {
    const text = `module.exports = { ...base, [key]: 1 };
`;

    expect(await run(text)).toBe(`export = { ...base, [key]: 1 };
`);
  });

  it('converts exports.<name> assignments to named exports', async () => {
    const text = `function helper() {}
exports.helper = helper;
exports.LIMIT = 10;
module.exports.compute = (a, b) => a + b;
`;

    expect(await run(text)).toBe(`function helper() {}
export { helper };
export const LIMIT = 10;
export const compute = (a, b) => a + b;
`);
  });

  it('reads a sibling export through the binding the conversion leaves', async () => {
    const text = `exports.operation = function (options) {
  return exports.timeouts(options).length;
};
exports.timeouts = function (options) {
  return [module.exports.createTimeout(options)];
};
exports.createTimeout = (options) => options;
`;

    expect(await run(text)).toBe(`export const operation = function (options) {
  return timeouts(options).length;
};
export const timeouts = function (options) {
  return [createTimeout(options)];
};
export const createTimeout = (options) => options;
`);
  });

  it('leaves a file whose exported name is shadowed at the read', async () => {
    const text = `exports.operation = function (options) {
  var timeouts = exports.timeouts(options);
  return timeouts;
};
exports.timeouts = function (options) {
  return [options];
};
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('an exported name is also declared inside the file');
  });

  it('leaves a file that reads an export at the top level', async () => {
    const text = `exports.limit = 10;
const doubled = exports.limit * 2;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('an export is read at the top level of the file');
  });

  it('leaves a file that assigns both module.exports and exports.<name>', async () => {
    const text = `module.exports = run;
module.exports.helper = helper;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices).toEqual([
      {
        reason: 'the file assigns both module.exports and exports.<name>',
        hint: 'Rewrite these as ES module exports by hand; they are left as they are.',
        marked: true,
        recovered: true,
      },
    ]);
  });

  it('leaves a file that reads exports', async () => {
    const text = `exports.foo = 1;
console.log(Object.keys(exports));
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('exports is used outside a top level assignment');
  });

  it('marks the exports it left, at the first assignment, once for the file', async () => {
    const text = `exports.foo = 1;
exports.bar = 2;
console.log(Object.keys(exports));
`;

    const { result, notices } = runWithNotices(text);

    expect(result).toBe(`// TODO(ts-migrate): Rewrite these as ES module exports by hand; they are left as they are.
// exports is used outside a top level assignment
exports.foo = 1;
exports.bar = 2;
console.log(Object.keys(exports));
`);
    expect(notices[0].marked).toBe(true);
  });

  it('leaves the marker it already wrote alone when the run repeats', async () => {
    const text = `exports.foo = 1;
console.log(Object.keys(exports));
`;

    const once = runWithNotices(text).result as string;
    const { result: twice, notices } = runWithNotices(once);

    expect(twice).toBe(once);
    expect(once.match(/TODO\(ts-migrate\)/g)).toHaveLength(1);
    expect(notices[0].marked).toBe(true);
  });

  it('leaves a file that assigns module.exports inside a branch', async () => {
    const text = `exports.foo = 1;
if (legacy) {
  module.exports = fallback;
}
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('module.exports is used outside a top level assignment');
  });

  it('leaves a file that assigns the same export name twice', async () => {
    const text = `exports.foo = 1;
exports.foo = 2;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('the file assigns the same export name more than once');
  });

  it('leaves an export whose name is already declared in the file', async () => {
    const text = `const foo = 1;
exports.foo = 2;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('an export name is already declared in the file');
  });

  it('leaves conditional exports alone without reporting', async () => {
    const text = `if (legacy) {
  module.exports = fallback;
} else {
  module.exports = current;
}
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices).toEqual([]);
  });

  it('emits ESM forms for a .mts file', async () => {
    const text = `const fs = require('fs');
const { join } = require('path');
module.exports = run;
`;

    expect(await run(text, { fileName: mtsFile })).toBe(`import fs from 'fs';
import { join } from 'path';
export default run;
`);
  });

  it('emits ESM forms inside a type module package', async () => {
    const text = `const fs = require('fs');
module.exports = run;
`;

    expect(await run(text, { fileName: esmFile })).toBe(`import fs from 'fs';
export default run;
`);
  });

  it('emits ESM forms for a file that already uses module syntax', async () => {
    const text = `import Widget from './Widget';
const fs = require('fs');
module.exports = Widget;
`;

    expect(await run(text)).toBe(`import Widget from './Widget';
import fs from 'fs';
export default Widget;
`);
  });

  it('leaves a file that already has a default export', async () => {
    const text = `export default Widget;
module.exports = Widget;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices[0].reason).toBe('the file already has a default export');
  });

  it('lets the esm option override the detection', async () => {
    const text = `const fs = require('fs');
module.exports = run;
`;

    expect(await run(text, { options: { esm: true } })).toBe(`import fs from 'fs';
export default run;
`);
    expect(await run(text, { fileName: mtsFile, options: { esm: false } }))
      .toBe(`import fs = require('fs');
export = run;
`);
  });

  it('leaves a file with no CommonJS syntax alone', async () => {
    const text = `import foo from './foo';

export const bar = foo;
`;

    const { result, notices } = runWithNotices(text);
    expect(withoutMarkers(result as string)).toBe(text);
    expect(notices).toEqual([]);
  });

  it('rejects unknown options', () => {
    expect(() => convertCommonjsPlugin.validate!({ esm: 'yes' })).toThrow();
    expect(() => convertCommonjsPlugin.validate!({ unknown: true })).toThrow();
    expect(convertCommonjsPlugin.validate!({ esm: true })).toBe(true);
  });
});
