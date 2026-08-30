import ts from 'typescript';
import { printType, PrintTypeOptions, TypePrintRefusal } from '../../../src/utils/typePrinter';
import { createInMemoryProgram } from '../../test-utils';

const fileName = '/print.ts';

/** Prints the type of `const value = <expression>` from the file's own scope. */
function print(
  declarations: string,
  expression: string,
  options?: PrintTypeOptions,
  extraFiles: { [name: string]: string } = {},
) {
  const files: { [name: string]: string } = {
    ...extraFiles,
    [fileName]: `${declarations}\nconst value = ${expression};\n`,
  };
  const program = createInMemoryProgram(files, { rootNames: [fileName] });
  const source = program.getSourceFile(fileName);
  if (!source) throw new Error('no source file');

  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'value') {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  if (!declaration?.initializer) throw new Error('no declaration');

  const checker = program.getTypeChecker();
  return printType(checker, checker.getTypeAtLocation(declaration.initializer), declaration, options);
}

function printed(declarations: string, expression: string, options?: PrintTypeOptions): string {
  const result = print(declarations, expression, options);
  if (!result.printable) throw new Error(`refused: ${result.reason}`);
  return result.text;
}

function refusal(
  declarations: string,
  expression: string,
  options?: PrintTypeOptions,
  extraFiles?: { [name: string]: string },
): TypePrintRefusal | 'printed' {
  const result = print(declarations, expression, options, extraFiles);
  return result.printable ? 'printed' : result.reason;
}

describe('printType', () => {
  it('prints primitives and literals', () => {
    expect(printed('', 'null')).toBe('null');
    expect(printed('', 'undefined')).toBe('undefined');
    expect(printed('declare const s: string;', 's')).toBe('string');
    expect(printed('', "'a' as const")).toBe('"a"');
    expect(printed('', '7 as const')).toBe('7');
  });

  it('widens literals on request', () => {
    expect(printed('', "'a' as const", { widenLiterals: true })).toBe('string');
    expect(printed('', '7 as const', { widenLiterals: true })).toBe('number');
    expect(printed('', 'true as const', { widenLiterals: true })).toBe('boolean');
  });

  it('prints the boolean intrinsic as one member', () => {
    expect(printed('declare const b: boolean;', 'b')).toBe('boolean');
  });

  it('prints named types declared in the file', () => {
    expect(printed('interface Widget { id: number }\ndeclare const w: Widget;', 'w')).toBe('Widget');
    expect(printed('class Widget {}', 'new Widget()')).toBe('Widget');
    expect(printed('enum Color { Red }', 'Color.Red')).toBe('Color');
    expect(printed('type Widget = { id: number };\ndeclare const w: Widget;', 'w')).toBe('Widget');
  });

  it('prints arrays of printable elements', () => {
    expect(printed('declare const a: string[];', 'a')).toBe('string[]');
    expect(printed('declare const a: (string | number)[];', 'a')).toBe('(string | number)[]');
    expect(refusal('declare const a: { id: number }[];', 'a')).toBe('anonymous');
  });

  // The element type of the array is the alias again, so following it does not
  // end. `classnames` and every hand written JSON type are spelled this way.
  it('refuses an array that reaches itself through its element type', () => {
    expect(refusal('type Json = string | Json[];\ndeclare const a: Json;', 'a')).toBe('circular');
    expect(
      refusal(
        'type Argument = string | ArgumentArray;\ntype ArgumentArray = Array<Argument>;\ndeclare const a: ArgumentArray;',
        'a',
      ),
    ).toBe('circular');
    expect(refusal('type Nested = Nested[];\ndeclare const a: Nested;', 'a')).toBe('circular');
  });

  // The guard tracks the way down, not every array already printed, so an
  // array reached twice on separate branches still prints.
  it('prints the same array type in two places of one union', () => {
    expect(printed('declare const a: string[] | number[];', 'a')).toBe('string[] | number[]');
  });

  it('splits unions and deduplicates the members', () => {
    expect(printed('declare const a: string | null;', 'a')).toBe('null | string');
    expect(printed('declare const a: "x" | "y";', 'a', { widenLiterals: true })).toBe('string');
  });

  it('collapses the two literals a union carries a boolean as', () => {
    expect(printed('declare const a: string | boolean;', 'a')).toBe('string | boolean');
  });

  // `any` is assignable in both directions, so a caller re-checking a candidate
  // gets no signal from it, and `T | any` erases `T`.
  it('refuses any before anything else', () => {
    expect(refusal('declare const a: any;', 'a')).toBe('any');
    expect(refusal('declare const a: string | any;', 'a')).toBe('any');
  });

  it('refuses unknown and never', () => {
    expect(refusal('declare const a: unknown;', 'a')).toBe('unknown');
    expect(refusal('declare function f(): never;', 'f()')).toBe('never');
  });

  // Only `undefined` is assignable to `void`, so a member widened to hold it is
  // harder to use than it was, and the union around it is refused with it.
  it('refuses void wherever it appears, and keeps undefined', () => {
    expect(refusal('declare function f(): void;', 'f()')).toBe('void');
    expect(refusal('declare function f(): string | void;', 'f()')).toBe('void');
    expect(refusal('declare function f(): void[];', 'f()')).toBe('void');
    expect(printed('declare function f(): string | undefined;', 'f()')).toBe('undefined | string');
  });

  it('refuses anonymous object and function shapes', () => {
    expect(refusal('', '{ id: 1 }')).toBe('anonymous');
    expect(refusal('', '(() => {}) as () => void')).toBe('anonymous');
  });

  it('refuses generics that would need type arguments', () => {
    expect(refusal('', 'new Map<string, number>()')).toBe('type-arguments');
    expect(refusal('type Box<T> = { item: T };\ndeclare const b: Box<string>;', 'b')).toBe(
      'type-arguments',
    );
  });

  it('refuses a union past the cap', () => {
    const declarations = 'declare const a: string | number | boolean | bigint | symbol;';
    expect(refusal(declarations, 'a')).toBe('union-too-large');
    expect(printed(declarations, 'a', { maxUnionMembers: 5 })).toBe(
      'string | number | bigint | boolean | symbol',
    );
  });

  it('refuses a type it can only name through an import', () => {
    const widgets = { '/widgets.ts': 'export interface Widget { id: number }\n' };
    expect(
      refusal(
        `import type { Widget } from './widgets';\ndeclare function make(): Widget;`,
        'make()',
        undefined,
        widgets,
      ),
    ).toBe('printed');
    expect(
      refusal(`declare function make(): import('./widgets').Widget;`, 'make()', undefined, widgets),
    ).toBe('needs-import');
  });
});
