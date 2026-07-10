import { replaceJSON5Strings, setJSON5Key } from '../../utils/updateJSON5';

describe('replaceJSON5Strings', () => {
  it('preserves comments, quoting, and formatting around replacements', () => {
    const source = `{
  // header comment
  "allowedImports": [
    'single.js', // line comment
    "double.jsx",
    "untouched/**/*",
  ],
  layout: "layout.js" /* block comment */,
}`;
    const result = replaceJSON5Strings(source, (keyPath, value) =>
      /\.jsx?$/.test(value) ? value.replace(/\.js(x?)$/, '.ts$1') : undefined,
    );
    expect(result).toBe(`{
  // header comment
  "allowedImports": [
    'single.ts', // line comment
    "double.tsx",
    "untouched/**/*",
  ],
  layout: "layout.ts" /* block comment */,
}`);
  });

  it('addresses values by path', () => {
    const result = replaceJSON5Strings('{ "a": "x.js", "b": "x.js" }', (keyPath, value) =>
      keyPath.length === 1 && keyPath[0] === 'a' ? value.replace(/\.js$/, '.ts') : undefined,
    );
    expect(result).toBe('{ "a": "x.ts", "b": "x.js" }');
  });

  it('reports object keys and array indices in paths', () => {
    const paths: Array<ReadonlyArray<string | number>> = [];
    replaceJSON5Strings('{ "arr": ["a", { key: "b" }] }', (keyPath) => {
      paths.push(keyPath);
      return undefined;
    });
    expect(paths).toEqual([
      ['arr', 0],
      ['arr', 1, 'key'],
    ]);
  });

  it('escapes replacement values', () => {
    const result = replaceJSON5Strings('{ "a": "old" }', () => 'quote " inside');
    expect(result).toBe('{ "a": "quote \\" inside" }');
  });

  it('handles escape sequences in source strings', () => {
    const result = replaceJSON5Strings('{ "a": "with \\"quotes\\".js" }', (keyPath, value) =>
      value.replace(/\.js$/, '.ts'),
    );
    expect(result).toBe('{ "a": "with \\"quotes\\".ts" }');
  });

  it('returns the source unchanged when nothing matches', () => {
    const source = '{ /* comment */ a: 1, "b": [true, null, 0x10], }';
    expect(replaceJSON5Strings(source, () => undefined)).toBe(source);
  });

  it('throws on invalid JSON5', () => {
    expect(() => replaceJSON5Strings('{ oops', () => undefined)).toThrow();
  });
});

describe('setJSON5Key', () => {
  it('adds a key to an existing multi-line object, preserving comments', () => {
    const source = `{
  // internal deps
  "internalDependencies": {
    "other": true
  }
}`;
    expect(setJSON5Key(source, ['internalDependencies', 'ts-utils'], true)).toBe(`{
  // internal deps
  "internalDependencies": {
    "other": true,
    "ts-utils": true
  }
}`);
  });

  it('keeps an existing trailing comma style', () => {
    const source = `{
  "internalDependencies": {
    "other": true,
  },
}`;
    expect(setJSON5Key(source, ['internalDependencies', 'ts-utils'], true)).toBe(`{
  "internalDependencies": {
    "other": true,
    "ts-utils": true,
  },
}`);
  });

  it('fills an empty object', () => {
    const result = setJSON5Key(
      '{ "internalDependencies": {} }',
      ['internalDependencies', 'ts-utils'],
      true,
    );
    expect(result).toBe('{ "internalDependencies": { "ts-utils": true } }');
  });

  it('creates missing objects along the path', () => {
    const source = `{
  "name": "my-project"
}`;
    expect(setJSON5Key(source, ['internalDependencies', 'ts-utils'], true)).toBe(`{
  "name": "my-project",
  "internalDependencies": { "ts-utils": true }
}`);
  });

  it('adds to a single-line object', () => {
    expect(setJSON5Key('{ "a": 1 }', ['b'], 'x')).toBe('{ "a": 1, "b": "x" }');
  });

  it('replaces the value of an existing key', () => {
    const source = "{ internalDependencies: { 'ts-utils': false } }";
    expect(setJSON5Key(source, ['internalDependencies', 'ts-utils'], true)).toBe(
      "{ internalDependencies: { 'ts-utils': true } }",
    );
  });

  it('replaces a non-object value on the path', () => {
    expect(setJSON5Key('{ "internalDependencies": false }', ['internalDependencies', 'a'], 1)).toBe(
      '{ "internalDependencies": { "a": 1 } }',
    );
  });

  it('throws when the root is not an object', () => {
    expect(() => setJSON5Key('[1]', ['a'], true)).toThrow('root value must be an object');
  });
});
