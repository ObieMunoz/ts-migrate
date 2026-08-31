import ts from 'typescript';
import { hasModifier, hasOnlyModifier, isStatic } from '../../../src/plugins/utils/modifiers';

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

function getStatements(sourceText: string, fileName = 'file.tsx'): ts.NodeArray<ts.Statement> {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true).statements;
}

describe('hasModifier', () => {
  it('detects the requested modifier', () => {
    const statements = getStatements(`
export const a = 1;
declare const b: number;
const c = 1;
export default class D {}`);

    expect(
      statements.map((statement) => hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword)),
    ).toEqual([true, false, false, true]);
  });

  it('ignores modifiers of other kinds', () => {
    const statements = getStatements('export declare const a: number;');

    expect(hasModifier(statements[0].modifiers, ts.SyntaxKind.AsyncKeyword)).toBe(false);
    expect(hasModifier(statements[0].modifiers, ts.SyntaxKind.DeclareKeyword)).toBe(true);
  });

  it('returns false when there are no modifiers', () => {
    expect(hasModifier(undefined, ts.SyntaxKind.ExportKeyword)).toBe(false);
  });
});

describe('hasOnlyModifier', () => {
  it('accepts a statement whose only modifier is the requested kind', () => {
    const statements = getStatements(`
export const a = 1;
const b = 1;
export declare const c: number;
declare const d: number;`);

    expect(
      statements.map((statement) =>
        hasOnlyModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword),
      ),
    ).toEqual([true, true, false, false]);
  });

  it('accepts an absent modifier list', () => {
    expect(hasOnlyModifier(undefined, ts.SyntaxKind.ExportKeyword)).toBe(true);
  });

  it('rejects a decorator alongside the requested modifier', () => {
    const statements = getStatements('@dec export class A {}');

    expect(hasOnlyModifier(statements[0].modifiers, ts.SyntaxKind.ExportKeyword)).toBe(false);
  });
});
