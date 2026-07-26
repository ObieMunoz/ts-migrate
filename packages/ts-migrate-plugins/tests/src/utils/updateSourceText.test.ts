import updateSourceText, { SourceTextUpdate } from '../../../src/utils/updateSourceText';

const insert = (index: number, text: string): SourceTextUpdate => ({ kind: 'insert', index, text });
const replace = (index: number, length: number, text: string): SourceTextUpdate => ({
  kind: 'replace',
  index,
  length,
  text,
});
const remove = (index: number, length: number): SourceTextUpdate => ({
  kind: 'delete',
  index,
  length,
});

describe('updateSourceText', () => {
  it('returns the source unchanged when there is nothing to do', () => {
    expect(updateSourceText('const a = 1;', [])).toBe('const a = 1;');
  });

  it('applies inserts, replaces and deletes in one pass', () => {
    const text = 'const a = 1;\nconst b = 2;\n';

    expect(
      updateSourceText(text, [
        replace(23, 1, '3'),
        insert(0, '// top\n'),
        remove(6, 1),
      ]),
    ).toBe('// top\nconst  = 1;\nconst b = 3;\n');
  });

  it('applies updates given out of order', () => {
    const text = 'ab';

    expect(updateSourceText(text, [insert(2, 'z'), insert(0, 'y')])).toBe('yabz');
  });

  it('keeps the order a plugin built several inserts at one position in', () => {
    const text = 'x';

    expect(updateSourceText(text, [insert(0, 'a'), insert(0, 'b'), insert(0, 'c')])).toBe('abcx');
  });

  describe('an insert at the position a replace starts', () => {
    const text = 'const a = 1;\n';
    // What a plugin writing a comment above a statement another plugin is
    // rewriting produces.
    const comment = insert(0, '// note\n');
    const rewrite = replace(0, 12, 'const a = 2;');
    const expected = '// note\nconst a = 2;\n';

    it('writes the insert first when it was pushed first', () => {
      expect(updateSourceText(text, [comment, rewrite])).toBe(expected);
    });

    it('writes the insert first when it was pushed last', () => {
      expect(updateSourceText(text, [rewrite, comment])).toBe(expected);
    });
  });

  describe('overlapping updates', () => {
    const text = 'const a = 1;\nconst b = 2;\n';

    it('throws for two replaces that share source', () => {
      expect(() => updateSourceText(text, [replace(0, 5, 'let'), replace(3, 4, 'x')])).toThrow(
        'Updates overlap: replace of 0..5 (line 1, column 1) and replace of 3..7 (line 1, column 4).',
      );
    });

    it('throws for an insert inside the span of a replace', () => {
      expect(() => updateSourceText(text, [replace(0, 12, 'x'), insert(6, '// note\n')])).toThrow(
        /Updates overlap: replace of 0\.\.12 .* and insert at 6 /,
      );
    });

    it('throws for a delete that reaches into the next update', () => {
      expect(() => updateSourceText(text, [remove(0, 14), replace(13, 5, 'let')])).toThrow(
        /Updates overlap/,
      );
    });

    it('names the line and column of each side, for finding them in the file', () => {
      expect(() => updateSourceText(text, [replace(13, 5, 'let'), replace(15, 3, 'x')])).toThrow(
        'Updates overlap: replace of 13..18 (line 2, column 1) and replace of 15..18 ' +
          '(line 2, column 3).',
      );
    });

    it('allows updates that only touch at the boundary', () => {
      expect(updateSourceText(text, [replace(0, 5, 'let'), replace(5, 2, '_b')])).toBe(
        'let_b = 1;\nconst b = 2;\n',
      );
    });
  });

  it('rejects a negative index', () => {
    expect(() => updateSourceText('a', [insert(-1, 'x')])).toThrow('Update has negative index');
  });

  it('rejects a negative length', () => {
    expect(() => updateSourceText('a', [replace(0, -1, 'x')])).toThrow(
      'Update has negative length',
    );
  });
});
