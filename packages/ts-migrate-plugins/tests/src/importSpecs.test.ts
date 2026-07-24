import { packageNameFromNodeModulesPath } from '../../src/plugins/utils/importSpecs';

describe('packageNameFromNodeModulesPath', () => {
  it('returns undefined when the path is not under node_modules', () => {
    expect(packageNameFromNodeModulesPath('/src/components/Foo.tsx')).toBeUndefined();
  });

  it('ignores TypeScript built-in lib files', () => {
    expect(
      packageNameFromNodeModulesPath('/x/node_modules/typescript/lib/lib.dom.d.ts'),
    ).toBeUndefined();
  });

  it('extracts an unscoped package name', () => {
    expect(packageNameFromNodeModulesPath('/x/node_modules/react/index.d.ts')).toBe('react');
  });

  it('extracts a scoped package name', () => {
    expect(
      packageNameFromNodeModulesPath('/x/node_modules/@reduxjs/toolkit/dist/index.d.ts'),
    ).toBe('@reduxjs/toolkit');
  });

  it('maps an @types package to its runtime module name', () => {
    expect(packageNameFromNodeModulesPath('/x/node_modules/@types/react/index.d.ts')).toBe(
      'react',
    );
  });

  it('maps an @types package for a scoped module (double-underscore)', () => {
    expect(
      packageNameFromNodeModulesPath('/x/node_modules/@types/foo__bar/index.d.ts'),
    ).toBe('@foo/bar');
  });
});
