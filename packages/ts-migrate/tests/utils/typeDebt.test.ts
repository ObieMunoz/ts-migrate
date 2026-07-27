import { scanFileDebt } from '../../utils/typeDebt';

function suppressions(text: string, fileName = 'a.ts') {
  const debt = scanFileDebt(fileName, text, new Set(['$TSFixMe']));
  return { tsExpectError: debt.tsExpectError, tsIgnore: debt.tsIgnore, codes: debt.codes };
}

function count(text: string, fileName = 'a.ts') {
  const { tsExpectError, tsIgnore } = suppressions(text, fileName);
  return tsExpectError + tsIgnore;
}

describe('scanFileDebt', () => {
  describe('comment forms TypeScript treats as directives', () => {
    // Each of these suppresses the error on the line below it; `tsc` was the
    // oracle for the list. A form ts-migrate never writes itself is still debt
    // when a person wrote it.
    it.each([
      ['line comment', '// @ts-expect-error\n'],
      ['indented line comment', '  // @ts-expect-error\n'],
      ['triple-slash comment', '/// @ts-expect-error\n'],
      ['line comment with no space', '//@ts-expect-error\n'],
      ['ts-migrate line comment', '// @ts-expect-error TS(2322): Type msg\n'],
      ['block comment', '/* @ts-expect-error */\n'],
      ['block comment with no spaces', '/*@ts-expect-error*/\n'],
      ['JSDoc comment', '/** @ts-expect-error */\n'],
      ['JSDoc comment with no spaces', '/**@ts-expect-error*/\n'],
      ['JSDoc comment with a code', '/** @ts-expect-error TS(2322): Type msg */\n'],
    ])('counts a %s', (_name, comment) => {
      expect(count(`${comment}export const v: number = 'no';\n`)).toBe(1);
    });

    it.each([
      ['a function', '/** @ts-ignore */\nexport function f() {}\n'],
      ['a class member', 'class C {\n  /** @ts-ignore */\n  m() {}\n}\n'],
      ['an interface member', 'interface I {\n  /** @ts-ignore */\n  a: string;\n}\n'],
      ['a type alias', '/** @ts-ignore */\ntype T = string;\n'],
      ['nothing, at the end of the file', 'const a = 1;\n/** @ts-ignore */\n'],
    ])('counts a JSDoc comment in front of %s', (_name, text) => {
      expect(count(text)).toBe(1);
    });

    it('reads the error code out of a JSDoc comment', () => {
      expect(suppressions('/** @ts-expect-error TS(2304): x */\nfoo();\n')).toEqual({
        tsExpectError: 1,
        tsIgnore: 0,
        codes: { TS2304: 1 },
      });
    });

    it('counts a trailing directive after code on the same line', () => {
      expect(count('const a = 1; // @ts-ignore\nfoo();\n')).toBe(1);
    });

    it('counts a comment holding several directives once', () => {
      expect(count('/* @ts-ignore @ts-ignore */\nfoo();\n')).toBe(1);
    });
  });

  describe('mentions TypeScript does not treat as directives', () => {
    // A directive only counts where it opens its comment line, which is what
    // makes TypeScript act on it. Prose about one suppresses nothing.
    it.each([
      ['a line comment', '// see the docs about @ts-expect-error first\n'],
      ['a TODO', '// TODO drop the @ts-expect-error below\n'],
      ['a block comment', '/* note: @ts-expect-error */\n'],
      ['a JSDoc comment', '/** note: @ts-expect-error */\n'],
      ['a JSDoc tag line', '/** @deprecated use @ts-expect-error */\n'],
    ])('ignores a mention inside %s', (_name, comment) => {
      expect(count(`${comment}foo();\n`)).toBe(0);
    });

    it.each([
      ['a string', "const s = '// @ts-ignore';\n"],
      ['a template literal', 'const s = `@ts-ignore`;\n'],
      ['a regular expression', 'const r = /@ts-ignore/;\n'],
    ])('ignores a directive inside %s', (_name, text) => {
      expect(count(text)).toBe(0);
    });

    it('ignores a directive inside JSX text', () => {
      expect(count('const x = <div>@ts-ignore</div>;\n', 'a.tsx')).toBe(0);
    });
  });

  describe('the forms ts-migrate itself writes', () => {
    it('counts a JSX expression comment', () => {
      const text = [
        'const x = (',
        '  <div>',
        "    {/* @ts-expect-error TS(7026): JSX element implicitly has type 'any' */}",
        '    <span />',
        '  </div>',
        ');',
        '',
      ].join('\n');
      expect(suppressions(text, 'a.tsx')).toEqual({
        tsExpectError: 1,
        tsIgnore: 0,
        codes: { TS7026: 1 },
      });
    });

    it('counts one per line comment', () => {
      const text = [
        '// @ts-expect-error TS(2304) FIXME: Cannot find name.',
        'foo();',
        '// @ts-ignore manual note',
        'bar();',
        '',
      ].join('\n');
      expect(suppressions(text)).toEqual({
        tsExpectError: 1,
        tsIgnore: 1,
        codes: { TS2304: 1 },
      });
    });
  });

  describe('any-type annotations', () => {
    it('counts explicit any and the discovered aliases', () => {
      const debt = scanFileDebt(
        'a.ts',
        'const a: any = 1;\nconst b: $TSFixMe = 2;\nconst c: any[] = [];\n',
        new Set(['$TSFixMe']),
      );
      expect({ any: debt.any, anyAlias: debt.anyAlias }).toEqual({ any: 2, anyAlias: 1 });
    });

    it('does not count an any inside a JSDoc type', () => {
      const debt = scanFileDebt('a.js', '/** @type {any} */\nconst a = 1;\n', new Set());
      expect(debt.any).toBe(0);
    });
  });

  it('handles a file with nothing in it', () => {
    expect(count('')).toBe(0);
  });
});
