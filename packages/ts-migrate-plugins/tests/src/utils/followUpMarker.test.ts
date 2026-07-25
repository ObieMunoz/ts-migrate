import ts from 'typescript';
import followUpMarkerUpdate, {
  FOLLOW_UP_MARKER,
  hasFollowUpMarker,
} from '../../../src/utils/followUpMarker';
import updateSourceText from '../../../src/utils/updateSourceText';

const parse = (text: string) =>
  ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Marks the last statement, which is what the fixtures below are about. */
function mark(text: string, hint = 'Do it by hand.', reason = 'It cannot be done here.') {
  const sourceFile = parse(text);
  const node = sourceFile.statements[sourceFile.statements.length - 1];
  const update = followUpMarkerUpdate(node, sourceFile, { hint, reason });
  return update ? updateSourceText(text, [update]) : undefined;
}

describe('followUpMarkerUpdate', () => {
  it('writes the hint and the reason above the site', () => {
    expect(mark('const a = 1;\nexport default a;\n')).toBe(
      `const a = 1;
// ${FOLLOW_UP_MARKER}: Do it by hand.
// It cannot be done here.
export default a;
`,
    );
  });

  it('keeps the indentation of the site it marks', () => {
    const text = `class A {
  method() {
    return 1;
  }
}
`;
    const sourceFile = parse(text);
    const method = (sourceFile.statements[0] as ts.ClassDeclaration).members[0];
    const update = followUpMarkerUpdate(method, sourceFile, {
      hint: 'Do it by hand.',
      reason: 'It cannot be done here.',
    });

    expect(updateSourceText(text, [update as never])).toBe(`class A {
  // ${FOLLOW_UP_MARKER}: Do it by hand.
  // It cannot be done here.
  method() {
    return 1;
  }
}
`);
  });

  it('wraps a long sentence rather than running past the code beside it', () => {
    const marked = mark(
      'export default 1;\n',
      'React 19 ignores defaultProps on function components. Convert to destructured parameter ' +
        'defaults by hand.',
      'Left defaultProps in place: a default value is not a literal.',
    ) as string;

    marked
      .split('\n')
      .filter((line) => line.startsWith('//'))
      .forEach((line) => expect(line.length).toBeLessThanOrEqual(96));
    // Wrapped, not truncated.
    expect(marked).toContain('destructured parameter defaults by hand.');
  });

  it('does not mark a site that already carries a marker', () => {
    const text = `// ${FOLLOW_UP_MARKER}: Do it by hand.\n// It cannot be done here.\nexport default 1;\n`;

    expect(mark(text)).toBeUndefined();
  });

  it('marks a site under an unrelated comment, and reads that as unmarked', () => {
    const text = '// an ordinary comment\nexport default 1;\n';
    const sourceFile = parse(text);
    const node = sourceFile.statements[0];

    expect(hasFollowUpMarker(node, sourceFile)).toBe(false);
    expect(mark(text)).toContain(`// an ordinary comment\n// ${FOLLOW_UP_MARKER}:`);
  });

  it('declines a site that shares its line with code the comment would then describe', () => {
    expect(mark('const a = 1; export default a;\n')).toBeUndefined();
  });
});
