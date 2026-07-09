import ts from 'typescript';
import { getTextPreservingWhitespace } from '../../../src/plugins/utils/text';

describe('getTextPreservingWhitespace', () => {
  it('preserves replacement-pattern characters in the printed node', () => {
    // `$$`, `$&`, `$1` etc. are special in String.replace replacement strings
    // and must come through literally.
    const sourceFile = ts.createSourceFile(
      'file.ts',
      `\ntype Props = { kind: '$$sale' | '$&' | '$1' };\n`,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );
    const [statement] = sourceFile.statements;

    const result = getTextPreservingWhitespace(statement, statement, sourceFile);

    expect(result).toBe(`\ntype Props = {\n    kind: '$$sale' | '$&' | '$1';\n};`);
  });
});
