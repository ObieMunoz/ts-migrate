import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import MigrationProject from '../src/migrate/MigrationProject';

// The npm alias pins the first major that dropped automatic @types loading,
// so this canary keeps working after the workspace `typescript` moves on.
const ts6: typeof ts = require('typescript6');

/**
 * TypeScript 5 loads every package under node_modules/@types when the
 * "types" option is unspecified; TypeScript 6 loads none unless "types"
 * contains "*" (which TypeScript 5 rejects as a package name). ts-migrate
 * bridges the two by pinning an explicit list in the tsconfig it generates.
 * This canary fails if a compiler release changes those semantics again.
 */
describe('automatic @types acquisition across compiler majors', () => {
  let rootDir: string;

  const writeFixture = (types?: string[]) => {
    // An OS temp dir: ancestor directories must not contribute type roots.
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-migrate-canary-'));
    const typesDir = path.join(rootDir, 'node_modules', '@types', 'node');
    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(
      path.join(typesDir, 'package.json'),
      JSON.stringify({ name: '@types/node', types: 'index.d.ts' }),
    );
    fs.writeFileSync(
      path.join(typesDir, 'index.d.ts'),
      'declare var require: (id: string) => any;\n',
    );
    fs.writeFileSync(path.join(rootDir, 'index.ts'), "var lib = require('some-lib');\n");
    fs.writeFileSync(
      path.join(rootDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'commonjs',
          moduleDetection: 'force',
          strict: true,
          skipLibCheck: true,
          ...(types !== undefined ? { types } : undefined),
        },
      }),
    );
  };

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function requireResolves(tsImpl: typeof ts): boolean {
    const configHost: ts.ParseConfigFileHost = {
      ...tsImpl.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(String(diagnostic.messageText));
      },
    };
    const parsed = tsImpl.getParsedCommandLineOfConfigFile(
      path.join(rootDir, 'tsconfig.json'),
      undefined,
      configHost,
    )!;
    const program = tsImpl.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host: tsImpl.createCompilerHost(parsed.options),
    });
    const sourceFile = program.getSourceFile(path.join(rootDir, 'index.ts').replace(/\\/g, '/'));
    return program.getSemanticDiagnostics(sourceFile).length === 0;
  }

  function migrationProjectResolves(): boolean {
    const project = new MigrationProject({
      tsConfigFilePath: path.join(rootDir, 'tsconfig.json'),
    });
    return (
      project.getLanguageService().getSemanticDiagnostics(path.join(rootDir, 'index.ts')).length ===
      0
    );
  }

  it('diverges across majors when "types" is unspecified — the hazard the generated tsconfig avoids', () => {
    writeFixture(undefined);
    const workspaceMajor = Number(ts.versionMajorMinor.split('.')[0]);
    expect(requireResolves(ts)).toBe(workspaceMajor < 6);
    expect(requireResolves(ts6)).toBe(false);
  });

  it('agrees across majors when the @types packages are pinned by name', () => {
    writeFixture(['node']);
    expect(requireResolves(ts)).toBe(true);
    expect(requireResolves(ts6)).toBe(true);
  });

  it('agrees across majors when "types" is empty', () => {
    writeFixture([]);
    expect(requireResolves(ts)).toBe(false);
    expect(requireResolves(ts6)).toBe(false);
  });

  it('MigrationProject matches plain tsc for the pinned form', () => {
    writeFixture(['node']);
    expect(migrationProjectResolves()).toBe(requireResolves(ts));
    expect(migrationProjectResolves()).toBe(true);
  });

  it('MigrationProject matches plain tsc when "types" is unspecified', () => {
    // Whatever the workspace compiler's default is, the migration engine
    // must agree with it — this is the invariant that keeps suppressions
    // from coming out unused in the follow-up compile check.
    writeFixture(undefined);
    expect(migrationProjectResolves()).toBe(requireResolves(ts));
  });
});
