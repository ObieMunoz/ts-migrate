import ts from 'typescript';
import { isStatic } from '../../../src/plugins/utils/modifiers';

function getMembers(sourceText: string, fileName = 'file.tsx'): ts.NodeArray<ts.ClassElement> {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const classDeclaration = sourceFile.statements.find(ts.isClassDeclaration);
  if (classDeclaration == null) throw new Error('no class declaration');
  return classDeclaration.members;
}

describe('isStatic', () => {
  it('detects static and non-static class members', () => {
    const members = getMembers(`
class Foo {
  static propTypes = {};
  static getDerivedStateFromProps() {}
  static get bar() { return 1; }
  state = {};
  render() {}
  get baz() { return 1; }
  constructor() { super(); }
}`);

    expect(members.map((member) => isStatic(member))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('ignores modifiers other than static', () => {
    const members = getMembers(`
class Foo {
  public readonly a = 1;
  private static b = 2;
  protected abstract c: number;
  declare d: number;
}`);

    expect(members.map((member) => isStatic(member))).toEqual([false, true, false, false]);
  });

  it('does not treat decorators as modifiers', () => {
    const members = getMembers(`
class Foo {
  @dec a = 1;
  @dec static b = 2;
}`);

    expect(members.map((member) => isStatic(member))).toEqual([false, true]);
  });

  it('returns false for JSDoc modifier tags in JS files', () => {
    const members = getMembers(
      `
class Foo {
  /** @public @readonly */
  a = 1;
}`,
      'file.js',
    );

    expect(members.map((member) => isStatic(member))).toEqual([false]);
  });
});
