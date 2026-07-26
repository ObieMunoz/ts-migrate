import ts from 'typescript';
import {
  splitTopLevel,
  buildTypeNode,
  widenTypes,
  isFunctionTypeStr,
} from '../../src/plugins/utils/typeStrings';

function print(typeStr: string, anyAlias?: string): string {
  return ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Unspecified,
      buildTypeNode(typeStr, anyAlias),
      ts.createSourceFile('x.ts', '', ts.ScriptTarget.Latest),
    );
}

describe('splitTopLevel', () => {
  it('splits a top-level union', () => {
    expect(splitTopLevel('string | number', ' | ')).toEqual(['string', 'number']);
  });

  it('keeps a nested union together', () => {
    expect(splitTopLevel('Array<string | number> | null', ' | ')).toEqual([
      'Array<string | number>',
      'null',
    ]);
  });

  it('does not treat the arrow of a function type as a closing bracket', () => {
    expect(splitTopLevel('() => void, string', ', ')).toEqual(['() => void', 'string']);
  });

  it('splits type arguments after an arrow-returning parameter', () => {
    expect(splitTopLevel('(cb: () => void) => void, number', ', ')).toEqual([
      '(cb: () => void) => void',
      'number',
    ]);
  });

  it('ignores a separator inside a string literal', () => {
    expect(splitTopLevel('"a | b"', ' | ')).toEqual(['"a | b"']);
  });

  it('ignores a separator inside a template literal', () => {
    expect(splitTopLevel('`a | b`', ' | ')).toEqual(['`a | b`']);
  });

  it('ignores an escaped quote inside a string literal', () => {
    expect(splitTopLevel('"a\\" | b" | number', ' | ')).toEqual(['"a\\" | b"', 'number']);
  });
});

describe('isFunctionTypeStr', () => {
  it('recognises a function signature', () => {
    expect(isFunctionTypeStr('(a: string) => void')).toBe(true);
  });

  it('does not recognise a type that merely contains one', () => {
    expect(isFunctionTypeStr('Map<() => void, string>')).toBe(false);
  });

  it('does not recognise a plain type reference', () => {
    expect(isFunctionTypeStr('ButtonSize')).toBe(false);
  });
});

describe('buildTypeNode', () => {
  it('keeps the arity of a generic whose argument is a function type', () => {
    expect(print('Map<() => void, string>')).toBe('Map<any, string>');
  });

  it('reconstructs a nested generic', () => {
    expect(print('Array<Record<string, number>>')).toBe('Array<Record<string, number>>');
  });
});

describe('widenTypes', () => {
  it('widens a string literal containing a union separator', () => {
    expect(widenTypes(['"a | b"'])).toBe('string');
  });

  it('widens observed literals to their base types', () => {
    expect(widenTypes(['"sm"', '"lg"'])).toBe('string');
  });

  it('unions differing base types', () => {
    expect(widenTypes(['"sm"', '42'])).toBe('string | number');
  });
});
