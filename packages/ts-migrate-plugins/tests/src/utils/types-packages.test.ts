import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildModuleDeclarations,
  collectTypesEvidence,
  createTypesEvidence,
  createTypesPackageDetector,
  formatTypesPackageReport,
  parseModuleDeclarations,
  renderModuleDeclarations,
  summarizeTypesEvidence,
  TypesEvidence,
} from '../../../src/utils/typesPackages';
import { realPluginParams } from '../../test-utils';

const fixtureDirs: string[] = [];

function makeFixture(files: { [filePath: string]: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'types-packages-'));
  fixtureDirs.push(dir);
  Object.entries(files).forEach(([filePath, contents]) => {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  });
  return dir;
}

afterAll(() => {
  fixtureDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const diagnostic = (code: number, messageText: string) => ({ code, messageText });

function nodeAndTestRunnerEvidence(): TypesEvidence {
  const evidence = createTypesEvidence();
  collectTypesEvidence(evidence, 'a.ts', [
    diagnostic(2580, "Cannot find name 'require'. Do you need to install type definitions for node?"),
    diagnostic(2582, "Cannot find name 'describe'. Do you need to install type definitions for a test runner?"),
    diagnostic(2304, "Cannot find name 'expect'."),
  ]);
  return evidence;
}

describe('collectTypesEvidence', () => {
  it('classifies diagnostics into environments and untyped modules', () => {
    const evidence = createTypesEvidence();
    collectTypesEvidence(evidence, 'a.ts', [
      diagnostic(2580, "Cannot find name 'require'. Do you need to install type definitions for node?"),
      diagnostic(2591, "Cannot find name 'process'. Do you need to install type definitions for node?"),
      diagnostic(2304, "Cannot find name '__dirname'."),
      diagnostic(2304, "Cannot find name 'notAGlobal'."),
      diagnostic(2503, "Cannot find namespace 'NodeJS'."),
      diagnostic(2584, "Cannot find name 'console'. Do you need to change your target library?"),
      diagnostic(2582, "Cannot find name 'describe'. Do you need to install type definitions for a test runner?"),
      diagnostic(2304, "Cannot find name 'expect'."),
      diagnostic(2307, "Cannot find module 'fs' or its corresponding type declarations."),
      diagnostic(2307, "Cannot find module 'node:path' or its corresponding type declarations."),
      diagnostic(2307, "Cannot find module 'left-pad' or its corresponding type declarations."),
      diagnostic(7016, "Could not find a declaration file for module 'lodash'. '/x/index.js' implicitly has an 'any' type."),
      diagnostic(7016, "Could not find a declaration file for module './relative'. '/x/y.js' implicitly has an 'any' type."),
    ]);
    collectTypesEvidence(evidence, 'b.ts', [
      diagnostic(2580, "Cannot find name 'require'."),
      diagnostic(7016, "Could not find a declaration file for module 'lodash'."),
      diagnostic(7016, "Could not find a declaration file for module '@acme/priv'."),
    ]);

    const node = evidence.env.get('node')!;
    expect(node.errorCount).toBe(7);
    expect(node.weakCount).toBe(1);
    expect(node.files).toEqual(new Set(['a.ts', 'b.ts']));
    expect(node.names).toContain('require');
    expect(node.names).toContain('__dirname');
    expect(node.names).toContain('NodeJS');
    expect(node.names).toContain('fs');

    const testRunner = evidence.env.get('testRunner')!;
    expect(testRunner.errorCount).toBe(2);
    expect(testRunner.names).toEqual(new Set(['describe', 'expect']));

    expect(Array.from(evidence.untypedModules.keys())).toEqual(['lodash', '@acme/priv']);
    const lodash = evidence.untypedModules.get('lodash')!;
    expect(lodash.errorCount).toBe(2);
    expect(lodash.files.size).toBe(2);
  });
});

describe('summarizeTypesEvidence', () => {
  it('recommends installs when nothing is installed, matching the package manager', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
      'yarn.lock': '',
    });
    const evidence = nodeAndTestRunnerEvidence();
    collectTypesEvidence(evidence, 'a.ts', [
      diagnostic(7016, "Could not find a declaration file for module 'lodash'."),
      diagnostic(7016, "Could not find a declaration file for module '@acme/priv'."),
      diagnostic(7016, "Could not find a declaration file for module 'lodash'."),
    ]);

    const report = summarizeTypesEvidence(evidence, rootDir);
    expect(report.packageManager).toBe('yarn');
    expect(report.missing.map((rec) => rec.packageName)).toEqual(['@types/jest', '@types/node']);
    expect(report.untyped.map((rec) => rec.packageName)).toEqual([
      '@types/lodash',
      '@types/acme__priv',
    ]);
    expect(report.notLoaded).toEqual([]);

    const formatted = formatTypesPackageReport(report, 'src')!;
    expect(formatted).toContain('Install: yarn add -D @types/jest @types/node');
    expect(formatted).toContain('Then try: yarn add -D @types/lodash @types/acme__priv');
    expect(formatted).toContain('npx -p @obiemunoz/ts-migrate ts-migrate reignore src');
  });

  it('tells the user to extend a pinned "types" array after installing', () => {
    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });

    const unpinned = summarizeTypesEvidence(nodeAndTestRunnerEvidence(), rootDir);
    expect(unpinned.typesPinned).toBe(false);
    expect(formatTypesPackageReport(unpinned, 'src')).not.toContain(
      'add each installed package to the "types" array',
    );

    const evidence = nodeAndTestRunnerEvidence();
    evidence.compilerTypes = ['mocha'];
    const report = summarizeTypesEvidence(evidence, rootDir);
    expect(report.typesPinned).toBe(true);
    expect(formatTypesPackageReport(report, 'src')).toContain(
      'add each installed package to the "types" array in tsconfig.json',
    );
  });

  it('suggests tsconfig wiring instead of an install when the package is already present', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({}),
      'node_modules/@types/node/package.json': JSON.stringify({
        name: '@types/node',
        version: '22.5.0',
      }),
    });
    const evidence = createTypesEvidence();
    collectTypesEvidence(evidence, 'a.ts', [diagnostic(2591, "Cannot find name 'process'.")]);
    evidence.compilerTypes = ['react'];

    const report = summarizeTypesEvidence(evidence, rootDir);
    expect(report.missing).toEqual([]);
    expect(report.notLoaded).toEqual([
      {
        packageName: '@types/node',
        advice: 'installed but not in the "types" array in tsconfig.json — add "node"',
      },
    ]);
  });

  it('points at "types"/"typeRoots" when the tsconfig has no types array', () => {
    const rootDir = makeFixture({
      'node_modules/@types/node/package.json': JSON.stringify({ version: '22.5.0' }),
    });
    const evidence = createTypesEvidence();
    collectTypesEvidence(evidence, 'a.ts', [diagnostic(2580, "Cannot find name 'require'.")]);

    const report = summarizeTypesEvidence(evidence, rootDir);
    expect(report.notLoaded[0].advice).toContain('check "types" and "typeRoots"');
  });

  it('resolves hoisted installs from a parent directory', () => {
    const rootDir = makeFixture({
      'node_modules/@types/node/package.json': JSON.stringify({ version: '22.5.0' }),
      'packages/app/package.json': JSON.stringify({}),
    });
    const evidence = createTypesEvidence();
    collectTypesEvidence(evidence, 'a.ts', [diagnostic(2580, "Cannot find name 'require'.")]);

    const report = summarizeTypesEvidence(evidence, path.join(rootDir, 'packages/app'));
    expect(report.missing).toEqual([]);
    expect(report.notLoaded.map((entry) => entry.packageName)).toEqual(['@types/node']);
  });

  it('flags installed @types packages whose major lags the library or runtime', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({
        engines: { node: '>=22' },
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
        devDependencies: {
          '@types/node': '^14',
          '@types/react': '^17',
          '@types/lodash': '^4',
        },
      }),
      'node_modules/@types/node/package.json': JSON.stringify({ version: '14.18.63' }),
      'node_modules/@types/react/package.json': JSON.stringify({ version: '17.0.83' }),
      'node_modules/@types/lodash/package.json': JSON.stringify({ version: '4.17.7' }),
      'node_modules/react/package.json': JSON.stringify({ version: '18.3.1' }),
      'node_modules/lodash/package.json': JSON.stringify({ version: '4.17.21' }),
    });

    const report = summarizeTypesEvidence(createTypesEvidence(), rootDir);
    expect(report.outdated).toEqual([
      {
        packageName: '@types/node',
        installedVersion: '14.18.63',
        suggestion: 'the project targets Node 22; consider @types/node@22',
      },
      {
        packageName: '@types/react',
        installedVersion: '17.0.83',
        suggestion: 'react@18.3.1 is installed; consider @types/react@18',
      },
    ]);
  });

  it('flags @types packages for libraries that ship their own types', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({
        dependencies: { axios: '^1.0.0' },
        devDependencies: { '@types/axios': '^0.14.0' },
      }),
      'node_modules/@types/axios/package.json': JSON.stringify({ version: '0.14.0' }),
      'node_modules/axios/package.json': JSON.stringify({
        version: '1.7.0',
        types: 'index.d.ts',
      }),
    });

    const report = summarizeTypesEvidence(createTypesEvidence(), rootDir);
    expect(report.redundant).toEqual([{ packageName: '@types/axios', libName: 'axios' }]);
    expect(report.outdated).toEqual([]);
  });

  it('recommends vitest tsconfig wiring rather than @types for vitest projects', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }),
    });

    const report = summarizeTypesEvidence(nodeAndTestRunnerEvidence(), rootDir);
    expect(report.missing.map((rec) => rec.packageName)).toEqual(['@types/node']);
    expect(report.notes[0]).toContain('"vitest/globals"');
  });

  it('notes ambiguous test globals when no runner is declared', () => {
    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });

    const report = summarizeTypesEvidence(nodeAndTestRunnerEvidence(), rootDir);
    expect(report.missing.map((rec) => rec.packageName)).toEqual(['@types/node']);
    expect(report.notes[0]).toContain('no test runner was found');
  });
});

describe('formatTypesPackageReport', () => {
  it('renders every section and skips empty reports', () => {
    expect(
      formatTypesPackageReport({
        packageManager: 'npm',
        missing: [],
        untyped: [],
        notLoaded: [],
        outdated: [],
        redundant: [],
        notes: [],
      }),
    ).toBeNull();

    const formatted = formatTypesPackageReport(
      {
        packageManager: 'pnpm',
        missing: [
          { packageName: '@types/node', errorCount: 214, fileCount: 38, exampleNames: ['require', 'process'] },
          { packageName: '@types/jest', errorCount: 1, fileCount: 1, exampleNames: ['describe'] },
        ],
        untyped: [
          { packageName: '@types/lodash', errorCount: 41, fileCount: 9, exampleNames: ["import 'lodash'"] },
        ],
        notLoaded: [{ packageName: '@types/jquery', advice: 'installed but not being loaded' }],
        outdated: [
          { packageName: '@types/react', installedVersion: '17.0.83', suggestion: 'consider @types/react@18' },
        ],
        redundant: [{ packageName: '@types/axios', libName: 'axios' }],
        notes: ['1 more untyped import(s) omitted.'],
      },
      'src',
    );
    expect(formatted).toMatchInlineSnapshot(`
      "Type definition recommendations:
        Missing type definitions:
          @types/node — 214 errors in 38 files (require, process)
          @types/jest — 1 error in 1 file (describe)
        Untyped imports (@types packages may exist for them):
          @types/lodash — 41 errors in 9 files (import 'lodash')
        Install: pnpm add -D @types/node @types/jest
        Then try: pnpm add -D @types/lodash
        Installed but not loaded:
          @types/jquery — installed but not being loaded
        Possibly outdated type definitions:
          @types/react@17.0.83 — consider @types/react@18
        Possibly redundant (the library ships its own types):
          @types/axios — axios bundles its own type definitions
        Note: 1 more untyped import(s) omitted.
        After installing type definitions, rerun: npx -p @obiemunoz/ts-migrate ts-migrate reignore src"
    `);
  });
});

describe('buildModuleDeclarations', () => {
  const untypedEvidence = (...moduleNames: string[]): TypesEvidence => {
    const evidence = createTypesEvidence();
    collectTypesEvidence(
      evidence,
      'a.ts',
      moduleNames.map((moduleName) =>
        diagnostic(7016, `Could not find a declaration file for module '${moduleName}'.`),
      ),
    );
    return evidence;
  };

  it('declares the modules with no types available', () => {
    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });

    const declarations = buildModuleDeclarations(
      untypedEvidence('left-pad', '@acme/priv', 'lodash/fp', './relative'),
      rootDir,
    )!;

    // The relative import is not a package; a shorthand declaration of it
    // would declare a module nothing resolves to.
    expect(declarations.moduleNames).toEqual(['@acme/priv', 'left-pad', 'lodash/fp']);
    expect(declarations.filePath).toBe(path.join(rootDir, 'types', 'ts-migrate-modules.d.ts'));
    expect(declarations.text).toContain("declare module '@acme/priv';");
    expect(declarations.text).toContain("declare module 'lodash/fp';");
    expect(parseModuleDeclarations(declarations.text)).toEqual(declarations.moduleNames);
  });

  it('leaves modules an installed @types package covers alone', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({}),
      'node_modules/@types/lodash/package.json': JSON.stringify({ version: '4.17.7' }),
    });

    expect(buildModuleDeclarations(untypedEvidence('lodash', 'lodash/fp'), rootDir)).toBeNull();
  });

  it('returns null when there is nothing to declare', () => {
    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });

    expect(buildModuleDeclarations(createTypesEvidence(), rootDir)).toBeNull();
  });

  it('keeps earlier declarations and drops the ones that gained types', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({}),
      'types/ts-migrate-modules.d.ts': renderModuleDeclarations([
        'left-pad',
        'now-typed',
        'ships-types',
      ]),
      'node_modules/@types/now-typed/package.json': JSON.stringify({ version: '1.0.0' }),
      'node_modules/ships-types/package.json': JSON.stringify({
        version: '2.0.0',
        types: 'index.d.ts',
      }),
    });

    // A declared module stops producing TS7016, so an earlier run's entries
    // are only in the evidence of the run that first found them.
    const declarations = buildModuleDeclarations(untypedEvidence('another-untyped'), rootDir)!;

    expect(declarations.moduleNames).toEqual(['another-untyped', 'left-pad']);
  });

  it('empties the file once every module it declared has types', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({}),
      'types/ts-migrate-modules.d.ts': renderModuleDeclarations(['now-typed']),
      'node_modules/@types/now-typed/package.json': JSON.stringify({ version: '1.0.0' }),
    });

    // Leaving the file alone would keep its declarations shadowing the types
    // that replaced them, so it is rewritten empty rather than skipped.
    const declarations = buildModuleDeclarations(createTypesEvidence(), rootDir)!;

    expect(declarations.moduleNames).toEqual([]);
    expect(declarations.text).not.toContain('declare module');
    expect(parseModuleDeclarations(declarations.text)).toEqual([]);

    const report = summarizeTypesEvidence(createTypesEvidence(), rootDir);
    report.declared = declarations;
    expect(formatTypesPackageReport(report, 'src')).toContain('now has types, so the file is empty');
  });

  it('does not touch a declaration file it did not write', () => {
    const rootDir = makeFixture({
      'package.json': JSON.stringify({}),
      'types/ts-migrate-modules.d.ts': "declare module 'hand-written';\n",
    });

    expect(buildModuleDeclarations(untypedEvidence('left-pad'), rootDir)).toBeNull();
  });

  it('reports the file it generated alongside the @types suggestions', () => {
    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });
    const evidence = untypedEvidence('left-pad');

    const report = summarizeTypesEvidence(evidence, rootDir);
    report.declared = buildModuleDeclarations(evidence, rootDir)!;

    const formatted = formatTypesPackageReport(report, 'src')!;
    expect(formatted).toContain('Try: npm install -D @types/left-pad');
    expect(formatted).toContain(
      '1 module with no types available is declared in types/ts-migrate-modules.d.ts',
    );
  });
});

describe('createTypesPackageDetector', () => {
  it('collects evidence from real diagnostics without changing the file', async () => {
    const detector = createTypesPackageDetector();
    const params = await realPluginParams({
      text: [
        "const fs = require('fs');",
        '',
        "describe('suite', () => {",
        "  it('works', () => {});",
        '});',
        '',
        'module.exports = fs;',
        '',
      ].join('\n'),
    });

    const result = await detector.plugin.run(params);
    expect(result).toBeUndefined();

    const rootDir = makeFixture({ 'package.json': JSON.stringify({}) });
    const report = detector.summarize(rootDir);
    const missingNode = report.missing.find((rec) => rec.packageName === '@types/node')!;
    expect(missingNode.errorCount).toBeGreaterThanOrEqual(2);
    expect(missingNode.exampleNames).toContain('require');
    expect(report.notes.some((note) => note.includes('no test runner was found'))).toBe(true);
  });
});
