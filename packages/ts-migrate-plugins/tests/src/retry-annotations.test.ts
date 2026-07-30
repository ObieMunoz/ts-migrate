import path from 'path';
import ts from 'typescript';
import { fixturePluginParams, mockPluginParams, realPluginParams } from '../test-utils';
import retryAnnotationsPlugin from '../../src/plugins/retry-annotations';

async function run(text: string, compilerOptions?: ts.CompilerOptions): Promise<string | void> {
  return retryAnnotationsPlugin.run(await realPluginParams({ text, compilerOptions }));
}

// The types a dependency brings, in a module the validation programs resolve
// from disk the way they would resolve an installed @types package.
const rootDir = path.resolve(__dirname, '../fixtures/retry-annotations');
const entryFile = path.join(rootDir, 'entry.ts');

function runInFixture(text: string): string | void {
  return retryAnnotationsPlugin.run(fixturePluginParams({ rootDir, fileName: entryFile, text }));
}

describe('retry-annotations plugin', () => {
  it('replaces an annotation the dependency now types', () => {
    const text = `import { stamp } from './types';

export function label(when: any) {
  return stamp(when);
}
`;

    expect(runInFixture(text)).toBe(`import { stamp } from './types';

export function label(when: Date) {
  return stamp(when);
}
`);
  });

  it('replaces an annotation naming an alias the project declares as any', () => {
    const text = `import { stamp } from './types';

type $TSFixMe = any;

export function label(when: $TSFixMe) {
  return stamp(when);
}
`;

    expect(runInFixture(text)).toBe(`import { stamp } from './types';

type $TSFixMe = any;

export function label(when: Date) {
  return stamp(when);
}
`);
  });

  it('narrows a rest parameter from the call its body makes', () => {
    const text = `import { total } from './types';

export function sum(...values: any[]) {
  return total(values);
}
`;

    expect(runInFixture(text)).toBe(`import { total } from './types';

export function sum(...values: number[]) {
  return total(values);
}
`);
  });

  it('keeps the annotation it can replace and restores the one beside it', () => {
    const text = `import { stamp } from './types';

export function label(when: any, extra: any) {
  return stamp(when) + String(extra);
}
`;

    expect(runInFixture(text)).toBe(`import { stamp } from './types';

export function label(when: Date, extra: any) {
  return stamp(when) + String(extra);
}
`);
  });

  it('changes nothing on a second run', () => {
    const text = `import { stamp } from './types';

export function label(when: any, extra: any) {
  return stamp(when) + String(extra);
}

export const count: any = 1;
export const items: any = [];
`;

    const once = runInFixture(text) as string;
    expect(once).not.toBe(text);
    expect(runInFixture(once)).toBe(once);
  });

  it('restores an annotation nothing can infer, byte for byte', async () => {
    const text = `export function passthrough(value: any) {
  switch   (1) {
    default:
      return value;
  }
}
`;

    expect(await run(text)).toBe(text);
  });

  it('annotates a variable from what is assigned to it later', async () => {
    const text = `export let cached: any;

cached = String(1);
`;

    expect(await run(text)).toBe(`export let cached: string;

cached = String(1);
`);
  });

  it('keeps the annotation of a variable whose type only its uses establish', async () => {
    // The declared type without an annotation is the evolving any, whatever
    // control flow makes of it at each use.
    const text = `export function read(): string {
  let cached: any;
  cached = String(1);
  return cached;
}
`;

    expect(await run(text)).toBe(text);
  });

  it('drops an annotation the initializer already types', async () => {
    const text = `export const count: any = 1;
export const name: any = 'widget';
`;

    expect(await run(text)).toBe(`export const count = 1;
export const name = 'widget';
`);
  });

  it('keeps an annotation whose removal would leave an array of nothing', async () => {
    const text = `export const items: any = [];
`;

    expect(await run(text)).toBe(text);
    expect(await run(text, { strict: false, noImplicitAny: false })).toBe(text);
  });

  it('leaves a class property to the type its constructor assignment gives it', async () => {
    const text = `export class Counter {
  count: any;

  constructor() {
    this.count = 0;
  }

  next() {
    return this.count + 1;
  }
}
`;

    expect(await run(text)).toBe(`export class Counter {
  count;

  constructor() {
    this.count = 0;
  }

  next() {
    return this.count + 1;
  }
}
`);
  });

  it('keeps a class property nothing assigns', async () => {
    const text = `export class Counter {
  count?: any;

  next() {
    return this.count;
  }
}
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the annotation where the only evidence is a null argument', async () => {
    // `null` is what the engine prints when nothing else was ever passed, and an
    // annotation of it rejects every real value the parameter later holds.
    const text = `function save(widget: any) {
  return read(widget);
}

function read(widget: any) {
  return widget;
}

export const saved = save(null);
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the annotation where the inferred type is too wide to write', async () => {
    // The engine prints the whole structural shape it found, comments included.
    const text = `const defaultRules = {
  /** Which plural form a count takes. */
  plurals: { one: (n: number) => n, few: (n: number) => n + 1, many: (n: number) => n + 2 },
  /** Which languages use which form. */
  languages: { one: ['en'], few: ['ru'], many: ['ar'] },
};

export function describeRules(source: any) {
  const rules = source || defaultRules;
  return Object.keys(rules.plurals).length + Object.keys(rules.languages).length;
}
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the annotation where the replacement would hold more any than it', async () => {
    // `(arg0: any, arg1: any) => any` says a little more and costs two more
    // `any` than the annotation it replaces, which reads as debt growth.
    const text = `export function apply(source: any, callback: any) {
  return callback(source.first, source.second);
}
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves a user written annotation alone', async () => {
    const text = `export function label(when: Date): string {
  return when.toISOString();
}

export const count: number = 1;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves an alias that is not any alone', async () => {
    const text = `type Loose = string;

export const name: Loose = 'widget';
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves the annotations of a type alone', async () => {
    const text = `export type Handler = (event: any) => void;

export interface Props {
  onClick: any;
}

export declare const configured: any;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves a this parameter alone', async () => {
    const text = `export function label(this: any) {
  return String(this);
}
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps an annotation whose removal would leave a silent implicit any', async () => {
    const text = `export function passthrough(value: any) {
  return value;
}
`;

    expect(await run(text, { strict: false, noImplicitAny: false })).toBe(text);
  });

  it('does not query the language service for a file with no any annotation', () => {
    const params = mockPluginParams({ text: 'export const answer: number = 42;\n' });
    const result = retryAnnotationsPlugin.run({
      ...params,
      getLanguageService: () => {
        throw new Error('the language service must not be queried');
      },
    });

    expect(result).toBe('export const answer: number = 42;\n');
  });
});
