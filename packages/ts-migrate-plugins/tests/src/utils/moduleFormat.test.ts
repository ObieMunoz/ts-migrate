import path from 'path';
import ts from 'typescript';
import { isEsmFilePath, isEsmSourceFile } from '../../../src/utils/moduleFormat';

const fixturesDir = path.resolve(__dirname, '../../fixtures/module-format');
const cjsPackageDir = path.join(fixturesDir, 'src');
const esmPackageDir = path.join(fixturesDir, 'esm', 'src');

const sourceFileOf = (fileName: string, text: string) =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

describe('isEsmFilePath', () => {
  it.each([
    ['entry.ts', false],
    ['entry.tsx', false],
    ['entry.mts', true],
    ['entry.mjs', true],
    ['entry.cts', false],
    ['entry.cjs', false],
  ])('reads %s outside an ESM package as esm=%s', (fileName, expected) => {
    expect(isEsmFilePath(path.join(cjsPackageDir, fileName))).toBe(expected);
  });

  it.each([
    ['entry.ts', true],
    ['entry.tsx', true],
    ['entry.mts', true],
    ['entry.mjs', true],
    ['entry.cts', false],
    ['entry.cjs', false],
  ])('reads %s in an ESM package as esm=%s', (fileName, expected) => {
    expect(isEsmFilePath(path.join(esmPackageDir, fileName))).toBe(expected);
  });
});

describe('isEsmSourceFile', () => {
  it('follows the path when the file carries no module syntax', () => {
    const ctsFile = path.join(esmPackageDir, 'entry.cts');
    expect(isEsmSourceFile(ctsFile, sourceFileOf(ctsFile, 'const a = 1;\n'))).toBe(false);

    const tsFile = path.join(esmPackageDir, 'entry.ts');
    expect(isEsmSourceFile(tsFile, sourceFileOf(tsFile, 'const a = 1;\n'))).toBe(true);
  });

  it('reads module syntax as esm outside an ESM package', () => {
    const tsFile = path.join(cjsPackageDir, 'entry.ts');
    expect(isEsmSourceFile(tsFile, sourceFileOf(tsFile, 'export const a = 1;\n'))).toBe(true);
  });

  it('keeps .cts commonjs even with module syntax', () => {
    const ctsFile = path.join(esmPackageDir, 'entry.cts');
    expect(isEsmSourceFile(ctsFile, sourceFileOf(ctsFile, 'export const a = 1;\n'))).toBe(false);
  });
});
