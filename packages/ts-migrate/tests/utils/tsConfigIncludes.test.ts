import fs from 'fs';
import path from 'path';
import isIncludedByTsConfig, {
  canKeepGeneratedDeclarations,
  ensureIncludedByTsConfig,
} from '../../utils/tsConfigIncludes';
import { createDir, deleteDir } from '../test-utils';

describe('tsConfigIncludes', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  const writeConfig = (text: string) =>
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), text);
  const readConfig = () => fs.readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf-8');

  const writeGenerated = (relative = 'types/ts-migrate-globals.d.ts') => {
    const filePath = path.join(rootDir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export {};\ndeclare global {}\n');
    return filePath;
  };

  describe('isIncludedByTsConfig', () => {
    it('answers true for a file the include matches', () => {
      writeConfig('{ "include": ["./types/**/*"] }');
      expect(isIncludedByTsConfig(rootDir, writeGenerated())).toBe(true);
    });

    it('answers false for a file outside the include', () => {
      writeConfig('{ "include": ["./app/**/*"] }');
      expect(isIncludedByTsConfig(rootDir, writeGenerated())).toBe(false);
    });

    it('answers true when there is no tsconfig to check against', () => {
      expect(isIncludedByTsConfig(rootDir, writeGenerated())).toBe(true);
    });
  });

  describe('canKeepGeneratedDeclarations', () => {
    it('is false without a tsconfig', () => {
      expect(canKeepGeneratedDeclarations(rootDir)).toBe(false);
    });

    it('is false when the tsconfig does not parse', () => {
      writeConfig('{ "include": [ ');
      expect(canKeepGeneratedDeclarations(rootDir)).toBe(false);
    });

    it('is true for a readable tsconfig', () => {
      writeConfig('{}');
      expect(canKeepGeneratedDeclarations(rootDir)).toBe(true);
    });
  });

  describe('ensureIncludedByTsConfig', () => {
    it('leaves a tsconfig that already matches the file alone', () => {
      writeConfig('{ "include": ["./types/**/*"] }');
      const result = ensureIncludedByTsConfig(rootDir, writeGenerated());
      expect(result.kind).toBe('included');
      expect(readConfig()).toBe('{ "include": ["./types/**/*"] }');
    });

    it('appends to the include the config declares itself', () => {
      writeConfig(`{
  "compilerOptions": { "noEmit": true },
  "include": ["./app/**/*"]
}`);
      const filePath = writeGenerated();
      const result = ensureIncludedByTsConfig(rootDir, filePath);

      expect(result).toMatchObject({
        kind: 'added',
        key: 'include',
        entry: './types/ts-migrate-globals.d.ts',
      });
      expect(readConfig()).toBe(`{
  "compilerOptions": { "noEmit": true },
  "include": ["./app/**/*", "./types/ts-migrate-globals.d.ts"]
}`);
      expect(isIncludedByTsConfig(rootDir, filePath)).toBe(true);
    });

    // Appending to "include" would take effect but drop every path the base
    // config contributes, so the additive list is the one to edit.
    it('uses files when the include is inherited through extends', () => {
      fs.writeFileSync(
        path.join(rootDir, 'tsconfig.base.json'),
        '{ "include": ["./app/**/*"] }',
      );
      writeConfig('{ "extends": "./tsconfig.base.json" }');
      const filePath = writeGenerated();
      const result = ensureIncludedByTsConfig(rootDir, filePath);

      expect(result).toMatchObject({ kind: 'added', key: 'files' });
      expect(readConfig()).toBe(
        '{ "extends": "./tsconfig.base.json", "files": ["./types/ts-migrate-globals.d.ts"] }',
      );
      expect(isIncludedByTsConfig(rootDir, filePath)).toBe(true);
    });

    // "exclude" filters "include" but not "files", so the first candidate
    // resolves to the same file set and is thrown away.
    it('falls through to files when the include is excluded', () => {
      writeConfig('{ "include": ["./**/*"], "exclude": ["./types"] }');
      const filePath = writeGenerated();
      const result = ensureIncludedByTsConfig(rootDir, filePath);

      expect(result).toMatchObject({ kind: 'added', key: 'files' });
      expect(isIncludedByTsConfig(rootDir, filePath)).toBe(true);
    });

    it('reports the edit without making it on a dry run', () => {
      writeConfig('{ "include": ["./app/**/*"] }');
      const result = ensureIncludedByTsConfig(rootDir, writeGenerated(), { dryRun: true });

      expect(result).toMatchObject({
        kind: 'would-add',
        key: 'include',
        entry: './types/ts-migrate-globals.d.ts',
      });
      expect(readConfig()).toBe('{ "include": ["./app/**/*"] }');
    });

    it('says nothing when there is no tsconfig to edit', () => {
      expect(ensureIncludedByTsConfig(rootDir, writeGenerated()).kind).toBe('included');
    });

    it('keeps comments and formatting in the config it edits', () => {
      writeConfig(`{
  // the app sources
  "include": [
    "./app/**/*", // everything under app
  ],
}`);
      ensureIncludedByTsConfig(rootDir, writeGenerated());
      expect(readConfig()).toBe(`{
  // the app sources
  "include": [
    "./app/**/*", // everything under app
    "./types/ts-migrate-globals.d.ts",
  ],
}`);
    });

    it('adds the alias declarations at the migration root', () => {
      writeConfig('{ "include": ["./app/**/*"] }');
      const filePath = writeGenerated('ts-migrate-aliases.d.ts');
      const result = ensureIncludedByTsConfig(rootDir, filePath);

      expect(result).toMatchObject({ kind: 'added', entry: './ts-migrate-aliases.d.ts' });
      expect(isIncludedByTsConfig(rootDir, filePath)).toBe(true);
    });
  });
});
