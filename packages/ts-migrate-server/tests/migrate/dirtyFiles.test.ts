import path from 'path';
import fs from 'fs';
import { createDir, deleteDir, writeFiles } from '@obiemunoz/ts-migrate-test-utils';
import computeDirtyFiles from '../../src/migrate/dirtyFiles';
import MigrationProject from '../../src/migrate/MigrationProject';

const BASE_OPTIONS = {
  target: 'esnext',
  module: 'commonjs',
  allowJs: true,
  jsx: 'react',
};

describe('computeDirtyFiles', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = fs.realpathSync(createDir());
  });
  afterEach(() => {
    deleteDir(rootDir);
  });

  const abs = (fileName: string) => path.join(rootDir, fileName).split(path.sep).join('/');

  function dirty(
    files: Record<string, string>,
    changed: string[],
    compilerOptions: Record<string, unknown> = {},
  ): string[] | null {
    fs.writeFileSync(
      path.join(rootDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { ...BASE_OPTIONS, ...compilerOptions },
        include: ['**/*'],
      }),
    );
    writeFiles(rootDir, files);

    const project = new MigrationProject({
      tsConfigFilePath: path.join(rootDir, 'tsconfig.json'),
    });
    const result = computeDirtyFiles(
      project.getSourceFiles(),
      new Set(changed.map(abs)),
      project.getCompilerOptions(),
      project.getModuleResolution(),
    );
    return result === null
      ? null
      : Array.from(result)
          .map((fileName) => path.relative(rootDir, fileName).split(path.sep).join('/'))
          .sort();
  }

  describe('module specifiers', () => {
    // Every shape that names another file, so a plugin group's next pass sees
    // the importer of whatever the last pass changed.
    const dependents: [string, string][] = [
      ['side-effect import', "import './b';\nexport {};"],
      ['default import', "import b from './b';\nexport { b };"],
      ['named import', "import { b } from './b';\nexport { b };"],
      ['namespace import', "import * as b from './b';\nexport { b };"],
      ['type-only import', "import type { B } from './b';\nexport type A = B;"],
      ['star re-export', "export * from './b';"],
      ['namespace re-export', "export * as ns from './b';"],
      ['type-only namespace re-export', "export type * as ns from './b';"],
      ['named re-export', "export { b } from './b';"],
      ['import equals require', "import b = require('./b');\nexport { b };"],
      ['require call', "const b = require('./b');\nexport { b };"],
      ['dynamic import', "export const load = () => import('./b');"],
      ['import type node', "export type A = typeof import('./b');"],
      ['amd define', "define(['./b'], (b: unknown) => b);\nexport {};"],
      ['triple-slash path reference', '/// <reference path="./b.ts" />\nexport const a = 1;'],
    ];

    dependents.forEach(([name, text]) => {
      it(`follows a ${name}`, () => {
        expect(dirty({ 'a.ts': text, 'b.ts': 'export const b = 1;\n' }, ['b.ts'])).toEqual([
          'a.ts',
          'b.ts',
        ]);
      });
    });

    it('leaves a file that only mentions the name in a string alone', () => {
      expect(
        dirty({ 'a.ts': `export const s = "import './b'";\n`, 'b.ts': 'export const b = 1;\n' }, [
          'b.ts',
        ]),
      ).toEqual(['b.ts']);
    });

    it('resolves through tsconfig paths', () => {
      expect(
        dirty(
          { 'a.ts': "import '@app/b';\nexport {};\n", 'src/b.ts': 'export const b = 1;\n' },
          ['src/b.ts'],
          { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
        ),
      ).toEqual(['a.ts', 'src/b.ts']);
    });

    it('resolves a package self-reference under its import condition', () => {
      // Only the `import` condition names esm.ts, so a resolution that fell
      // back to `require` would miss the edge entirely.
      expect(
        dirty(
          {
            'package.json': JSON.stringify({
              name: 'pkg',
              type: 'module',
              exports: { '.': { import: './esm.ts', require: './cjs.cts' } },
            }),
            'a.ts': "import 'pkg';\nexport {};\n",
            'esm.ts': 'export const b = 1;\n',
            'cjs.cts': 'export const b = 1;\n',
          },
          ['esm.ts'],
          { module: 'nodenext', moduleResolution: 'nodenext', allowImportingTsExtensions: true },
        ),
      ).toEqual(['a.ts', 'esm.ts']);
    });
  });

  describe('graph traversal', () => {
    const graph = {
      'importer.ts': "import './changed';\nexport {};\n",
      'changed.ts': "import './imported';\nexport const c = 1;\n",
      'imported.ts': 'export const i = 1;\n',
      'unrelated.ts': 'export const u = 1;\n',
    };

    it('walks importers and imports transitively, and stops there', () => {
      expect(dirty(graph, ['changed.ts'])).toEqual(['changed.ts', 'imported.ts', 'importer.ts']);
    });

    it('keeps a file out of its own dependency set when it imports itself', () => {
      expect(dirty({ 'a.ts': "import './a';\nexport const a = 1;\n" }, ['a.ts'])).toEqual(['a.ts']);
    });

    it('terminates on an import cycle', () => {
      expect(
        dirty(
          {
            'a.ts': "import './b';\nexport const a = 1;\n",
            'b.ts': "import './a';\nexport const b = 1;\n",
          },
          ['a.ts'],
        ),
      ).toEqual(['a.ts', 'b.ts']);
    });

    it('ignores a specifier that resolves outside the project', () => {
      expect(dirty({ 'a.ts': "import 'typescript';\nexport {};\n" }, ['a.ts'])).toEqual(['a.ts']);
    });
  });

  describe('changes the import graph cannot bound', () => {
    it('returns null for a changed script that is not a module', () => {
      expect(
        dirty({ 'a.ts': 'const a = 1;\n', 'b.ts': 'export const b = 1;\n' }, ['a.ts']),
      ).toBeNull();
    });

    it('returns null for a changed global augmentation', () => {
      expect(
        dirty(
          {
            'a.ts': 'export {};\ndeclare global { interface Window { z: 1 } }\n',
            'b.ts': 'export const b = 1;\n',
          },
          ['a.ts'],
        ),
      ).toBeNull();
    });

    it('returns null for a changed file that is not in the program', () => {
      expect(dirty({ 'a.ts': 'export const a = 1;\n' }, ['gone.ts'])).toBeNull();
    });
  });
});
