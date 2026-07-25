import ts from 'typescript';
import createFollowUpMarkers, {
  FOLLOW_UP_MARKER,
  hasFollowUpMarker,
  markerSite,
} from '../../../src/utils/followUpMarker';
import updateSourceText from '../../../src/utils/updateSourceText';

const parse = (text: string) =>
  ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const NOTE = { hint: 'Do it by hand.', reason: 'It cannot be done here.' };

/** Marks the last statement, which is what most of the fixtures below are about. */
function mark(text: string, note = NOTE) {
  const sourceFile = parse(text);
  const node = sourceFile.statements[sourceFile.statements.length - 1];
  const { update, marked } = createFollowUpMarkers(sourceFile).add(node, note);
  return { text: update ? updateSourceText(text, [update]) : undefined, marked };
}

describe('createFollowUpMarkers', () => {
  it('writes the hint and the reason above the site', () => {
    expect(mark('const a = 1;\nexport default a;\n')).toEqual({
      marked: true,
      text: `const a = 1;
// ${FOLLOW_UP_MARKER}: Do it by hand.
// It cannot be done here.
export default a;
`,
    });
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
    const { update } = createFollowUpMarkers(sourceFile).add(method, NOTE);

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
    const { text } = mark('export default 1;\n', {
      hint:
        'React 19 ignores defaultProps on function components. Convert to destructured ' +
        'parameter defaults by hand.',
      reason: 'Left defaultProps in place: a default value is not a literal.',
    });

    (text as string)
      .split('\n')
      .filter((line) => line.startsWith('//'))
      .forEach((line) => expect(line.length).toBeLessThanOrEqual(96));
    // Wrapped, not truncated.
    expect(text).toContain('destructured parameter defaults by hand.');
  });

  it('reports a site that already carries a marker as marked, without writing a second', () => {
    const text = `// ${FOLLOW_UP_MARKER}: Do it by hand.\n// It cannot be done here.\nexport default 1;\n`;

    expect(mark(text)).toEqual({ marked: true, text: undefined });
  });

  it('marks a site under an unrelated comment, and reads that as unmarked', () => {
    const text = '// an ordinary comment\nexport default 1;\n';
    const sourceFile = parse(text);

    expect(hasFollowUpMarker(sourceFile.statements[0], sourceFile)).toBe(false);
    expect(mark(text).text).toContain(`// an ordinary comment\n// ${FOLLOW_UP_MARKER}:`);
  });

  it('writes one marker however many causes land on the same site', () => {
    const text = 'export default 1;\n';
    const sourceFile = parse(text);
    const markers = createFollowUpMarkers(sourceFile);
    const node = sourceFile.statements[0];

    const first = markers.add(node, NOTE);
    const second = markers.add(node, { hint: 'Something else.', reason: 'Another cause.' });

    expect(first.update).toBeDefined();
    // Still marked: the site holds a marker, just not this cause's.
    expect(second).toEqual({ marked: true });
  });
});

describe('markerSite', () => {
  it('walks up to the statement when the node is inside a line', () => {
    const text = 'const a = (b as any).c;\n';
    const sourceFile = parse(text);
    const statement = sourceFile.statements[0];
    let paren!: ts.Node;
    const visit = (node: ts.Node) => {
      if (ts.isParenthesizedExpression(node)) paren = node;
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);

    // Whichever node it lands on, the marker goes where the statement begins.
    expect(markerSite(paren, sourceFile)?.getStart(sourceFile)).toBe(
      statement.getStart(sourceFile),
    );
  });

  it('has nowhere to mark a node that no line begins with', () => {
    const sourceFile = parse('const a = 1; const b = 2;\n');

    expect(markerSite(sourceFile.statements[1], sourceFile)).toBeUndefined();
  });

  it('has nowhere to mark the source file itself', () => {
    const sourceFile = parse('const a = 1;\n');

    expect(markerSite(sourceFile, sourceFile)).toBeUndefined();
  });
});
