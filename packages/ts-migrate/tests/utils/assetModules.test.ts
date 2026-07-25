import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ASSET_DECLARATIONS_FILE,
  AssetPackageJson,
  buildAssetDeclarations,
} from '../../utils/assetModules';
import { deleteDir } from '../test-utils';

describe('buildAssetDeclarations', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-assets-'));
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  /** Writes one source file and plans the declarations for it. */
  function plan(source: string, packageJson: AssetPackageJson | null = null) {
    const file = path.join(rootDir, 'app.jsx');
    fs.writeFileSync(file, source);
    return buildAssetDeclarations(rootDir, [file], packageJson);
  }

  const declaredExtensions = (source: string, packageJson?: AssetPackageJson) =>
    plan(source, packageJson ?? null)?.declared.map(({ extension }) => extension) ?? [];

  const skipReason = (source: string, packageJson?: AssetPackageJson) =>
    plan(source, packageJson ?? null)?.skipped.map(({ extension, reason }) => `${extension}: ${reason}`) ??
    [];

  it('returns null for a project with no asset imports', () => {
    expect(plan("import React from 'react';\nimport './util';\n")).toBeNull();
  });

  it('declares an image default import as its URL', () => {
    const declarations = plan("import logo from './logo.png';\n");

    expect(declarations?.declared).toEqual([{ extension: '.png', kind: 'url' }]);
    expect(declarations?.text).toContain("declare module '*.png' {");
    expect(declarations?.text).toContain('const src: string;');
    expect(declarations?.filePath).toBe(
      path.join(rootDir, ...ASSET_DECLARATIONS_FILE.split('/')),
    );
  });

  it('declares a side-effect import as a module with no exports', () => {
    const declarations = plan("import './App.css';\nimport './theme.scss';\n");

    expect(declarations?.declared).toEqual([
      { extension: '.css', kind: 'sideEffect' },
      { extension: '.scss', kind: 'sideEffect' },
    ]);
    expect(declarations?.text).toContain("declare module '*.css' {}");
  });

  // CSS modules: the record of class names depends on the loader and on its
  // version, so a shape here would type-check while being wrong.
  it('leaves a style sheet bound to a name undeclared', () => {
    expect(declaredExtensions("import styles from './App.css';\n")).toEqual([]);
    expect(skipReason("import styles from './App.css';\n")).toEqual([
      '.css: the value it exports depends on the loader',
    ]);
  });

  it('leaves an extension imported by name undeclared', () => {
    expect(declaredExtensions("import { ReactComponent } from './logo.svg';\n")).toEqual([]);
    expect(declaredExtensions("import * as icon from './logo.svg';\n")).toEqual([]);
    expect(declaredExtensions("export { ReactComponent } from './logo.svg';\n")).toEqual([]);
    expect(skipReason("import { ReactComponent } from './logo.svg';\n")).toEqual([
      '.svg: imported by name, so the loader decides what it exports',
    ]);
  });

  it('declares svg as a URL only when nothing can turn it into a component', () => {
    expect(declaredExtensions("import logo from './logo.svg';\n")).toEqual(['.svg']);
    expect(
      declaredExtensions("import logo from './logo.svg';\n", {
        devDependencies: { '@svgr/webpack': '^8.0.0' },
      }),
    ).toEqual([]);
    expect(
      skipReason("import logo from './logo.svg';\n", {
        devDependencies: { '@svgr/webpack': '^8.0.0' },
      }),
    ).toEqual(['.svg: @svgr/webpack can make it a component rather than a URL']);
  });

  it('leaves an extension whose value the loader decides undeclared', () => {
    expect(declaredExtensions("import config from './config.yaml';\n")).toEqual([]);
    expect(declaredExtensions("import query from './query.graphql';\n")).toEqual([]);
  });

  it('counts require and dynamic import as bindings', () => {
    expect(declaredExtensions("const logo = require('./logo.png');\n")).toEqual(['.png']);
    expect(declaredExtensions("const load = () => import('./logo.png');\n")).toEqual(['.png']);
  });

  it('skips specifiers a wildcard pattern would not match', () => {
    // Query and inline-loader syntax name something other than the file.
    expect(plan("import logo from './logo.svg?url';\nimport css from '!raw!./a.css';\n")).toBeNull();
  });

  it('ignores bare specifiers and code extensions', () => {
    expect(
      plan("import 'normalize.css';\nimport data from './fixture.json';\nimport './a.jsx';\n"),
    ).toBeNull();
  });

  it('declares the extension with the casing the project imports', () => {
    expect(declaredExtensions("import logo from './LOGO.PNG';\n")).toEqual(['.PNG']);
  });

  it('takes the strictest evidence across files', () => {
    const first = path.join(rootDir, 'a.jsx');
    const second = path.join(rootDir, 'b.jsx');
    fs.writeFileSync(first, "import './App.css';\n");
    fs.writeFileSync(second, "import styles from './Other.css';\n");

    expect(buildAssetDeclarations(rootDir, [first, second], null)?.declared).toEqual([]);
  });

  it('ignores a file it cannot read', () => {
    expect(buildAssetDeclarations(rootDir, [path.join(rootDir, 'missing.js')], null)).toBeNull();
  });
});
