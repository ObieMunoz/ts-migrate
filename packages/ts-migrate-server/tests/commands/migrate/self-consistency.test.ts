import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import migrate, { MigrateConfig } from '../../../src/migrate';
import MigrationProject from '../../../src/migrate/MigrationProject';
import { Plugin } from '../../../types';

const mockWarnings: string[] = [];
jest.mock('updatable-log', () => ({
  error: () => {},
  important: () => {},
  info: () => {},
  update: () => {},
  clear: () => {},
  quiet: false,
  warn: (...msg: unknown[]) => mockWarnings.push(msg.map(String).join(' ')),
}));

// A minimal stand-in for the ts-ignore plugin: suppress every semantic error
// the project's language service reports, exactly one directive per line.
const suppressErrorsPlugin: Plugin = {
  name: 'suppress-errors',
  async run({ getLanguageService, fileName, text }) {
    const diagnostics = getLanguageService()
      .getSemanticDiagnostics(fileName)
      .filter((diagnostic) => diagnostic.file && diagnostic.start !== undefined);
    const lines = text.split('\n');
    const codeByLine = new Map<number, number>();
    diagnostics.forEach((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
      if (!codeByLine.has(line)) codeByLine.set(line, diagnostic.code);
    });
    Array.from(codeByLine.entries())
      .sort(([lineA], [lineB]) => lineB - lineA)
      .forEach(([line, code]) => {
        lines.splice(line, 0, `// @ts-expect-error TS(${code}): suppressed by migration`);
      });
    return lines.join('\n');
  },
};

function writeFixture(rootDir: string, files: { [filePath: string]: string }) {
  Object.entries(files).forEach(([filePath, contents]) => {
    const fullPath = path.join(rootDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  });
}

describe('migrate self-consistency', () => {
  let rootDir: string;

  beforeEach(() => {
    // An OS temp dir so ancestor node_modules/@types directories (this
    // repo's own) cannot leak into the fixture's type roots.
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-consistency-'));
    mockWarnings.length = 0;
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('adds no suppressions for globals that pinned @types packages provide, and a fresh check agrees with the migration', async () => {
    writeFixture(rootDir, {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'commonjs',
          moduleDetection: 'force',
          strict: true,
          skipLibCheck: true,
          types: ['mocha', 'node'],
        },
      }),
      'node_modules/@types/node/package.json': JSON.stringify({
        name: '@types/node',
        types: 'index.d.ts',
      }),
      'node_modules/@types/node/index.d.ts':
        'declare var require: (id: string) => any;\ndeclare var module: { exports: any };\n',
      'node_modules/@types/mocha/package.json': JSON.stringify({
        name: '@types/mocha',
        types: 'index.d.ts',
      }),
      'node_modules/@types/mocha/index.d.ts':
        'declare function describe(title: string, fn: () => void): void;\n' +
        'declare function it(title: string, fn: () => void): void;\n',
      'index.ts':
        "var lib = require('some-lib');\n" +
        "describe('suite', function () {\n" +
        "  it('works', function () {});\n" +
        '});\n' +
        "var count: number = 'not a number';\n",
    });

    const config = new MigrateConfig().addPlugin(suppressErrorsPlugin, {});
    const { exitCode } = await migrate({ rootDir, config });
    expect(exitCode).toBe(0);

    const migrated = fs.readFileSync(path.join(rootDir, 'index.ts'), 'utf-8');
    // The genuine type error is suppressed...
    expect(migrated).toContain('@ts-expect-error TS(2322)');
    // ...but the pinned @types packages resolve require/describe/it, so no
    // environment-type suppressions appear.
    expect(migrated).not.toMatch(/TS\(2591\)|TS\(2593\)|TS\(2580\)|TS\(2582\)/);

    // A brand-new project over the written output must agree completely with
    // what the migration saw: no remaining errors, no unused directives.
    const freshProject = new MigrationProject({
      tsConfigFilePath: path.join(rootDir, 'tsconfig.json'),
    });
    const freshDiagnostics = freshProject
      .getLanguageService()
      .getSemanticDiagnostics(path.join(rootDir, 'index.ts'));
    expect(freshDiagnostics.map((d) => d.code)).toEqual([]);
  });

  it('warns when the project resolves a different typescript major than the migration', async () => {
    writeFixture(rootDir, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'index.ts': 'export const a = 1;\n',
      'node_modules/typescript/package.json': JSON.stringify({
        name: 'typescript',
        version: '1.2.3',
      }),
    });

    await migrate({ rootDir, config: new MigrateConfig() });

    const skewWarnings = mockWarnings.filter((warning) => warning.includes('typescript 1.2.3'));
    expect(skewWarnings).toHaveLength(1);
    expect(skewWarnings[0]).toContain('ts-migrate resolved');
  });

  it('does not warn when the project typescript matches the migration', async () => {
    writeFixture(rootDir, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'index.ts': 'export const a = 1;\n',
      // Same major as the running compiler; the warning must key on the
      // major comparison, not on a project typescript merely existing.
      'node_modules/typescript/package.json': JSON.stringify({
        name: 'typescript',
        version: ts.version,
      }),
    });

    await migrate({ rootDir, config: new MigrateConfig() });

    expect(mockWarnings.filter((warning) => warning.includes('resolved TypeScript'))).toEqual([]);
  });

  it('does not warn when no project typescript exists', async () => {
    writeFixture(rootDir, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'index.ts': 'export const a = 1;\n',
    });

    await migrate({ rootDir, config: new MigrateConfig() });

    expect(mockWarnings.filter((warning) => warning.includes('resolved TypeScript'))).toEqual([]);
  });
});
