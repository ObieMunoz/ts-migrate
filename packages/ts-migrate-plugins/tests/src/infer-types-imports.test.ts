import path from 'path';
import type { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { fixturePluginParams } from '../test-utils';
import inferTypesPlugin from '../../src/plugins/infer-types';

// A module the file imports a value from and not the type of that value, which
// is the shape an inferred annotation names and the file has no name for.
const rootDir = path.resolve(__dirname, '../fixtures/infer-types');
const entryFile = path.join(rootDir, 'entry.ts');

function run(text: string, reportFileNotice?: (notice: PluginFileNotice) => void): string | void {
  return inferTypesPlugin.run({
    ...fixturePluginParams({ rootDir, fileName: entryFile, text }),
    reportFileNotice,
  });
}

describe('infer-types plugin, the imports its annotations need', () => {
  it('imports the type an annotation names', () => {
    const text = `import { options } from './types';

declare const prefetchers: any;
prefetchers.map(prefetch => prefetch(options));
`;

    expect(run(text)).toBe(`import { Options, options } from './types';

declare const prefetchers: any;
prefetchers.map((prefetch: (arg0: Options) => any) => prefetch(options));
`);
  });

  it('keeps that import when the scope it was written into loses its own annotations', () => {
    // The property annotation and the import both belong to no function, so
    // the assignment that contradicts the property used to take the import
    // down with it and leave `Options` naming nothing.
    const text = `import { options } from './types';

class Registry {
  entry;
}
const registry = new Registry();
registry.entry = 1;
registry.entry = 'two';

declare const prefetchers: any;
prefetchers.map(prefetch => prefetch(options));
`;

    expect(run(text)).toBe(`import { options, Options } from './types';

class Registry {
  entry;
}
const registry = new Registry();
registry.entry = 1;
registry.entry = 'two';

declare const prefetchers: any;
prefetchers.map((prefetch: (arg0: Options) => any) => prefetch(options));
`);
  });

  it('imports what an annotation recomputed from the body alone names', () => {
    // The call sites make the engine widen `target` past what the body
    // supports, so the annotation is recomputed with them hidden. The import
    // the recomputed one needs is the second pass's to report, not the first's.
    const text = `import { connect } from './types';

export function open(target) {
  connect(target);
  return target.host.length;
}

open(1);
open('a');
`;

    expect(run(text)).toBe(`import { connect, Options } from './types';

export function open(target: Options) {
  connect(target);
  return target.host.length;
}

open(1);
open('a');
`);
  });

  it('binds a name once where two modules declare it', () => {
    // What redux and the toolkit that re-exports it look like from here: one
    // name, two modules, and an annotation that names it for both. The engine
    // asks for an import per symbol, and writing both binds the name twice,
    // which is a duplicate identifier rather than two imports.
    const text = `import { action } from './redux';
import { toolkitAction } from './toolkit';

declare const prefetchers: any;
prefetchers.map(prefetch => prefetch({ from: action, to: toolkitAction }));
`;

    expect(run(text)).toBe(`import { action, AnyAction } from './redux';
import { toolkitAction } from './toolkit';

declare const prefetchers: any;
prefetchers.map((prefetch: (arg0: { from: AnyAction; to: AnyAction; }) => any) => prefetch({ from: action, to: toolkitAction }));
`);
  });

  it('leaves a name the file already imports to the import it has', () => {
    const text = `import { AnyAction } from './redux';
import { toolkitAction } from './toolkit';

declare const seen: AnyAction;
declare const prefetchers: any;
prefetchers.map(prefetch => prefetch(toolkitAction));
console.log(seen);
`;

    expect(run(text)).toBe(`import { AnyAction } from './redux';
import { toolkitAction } from './toolkit';

declare const seen: AnyAction;
declare const prefetchers: any;
prefetchers.map((prefetch: (arg0: AnyAction) => any) => prefetch(toolkitAction));
console.log(seen);
`);
  });

  it('writes a whole import declaration for a module the file does not import', () => {
    const text = `declare const options: import('./types').Options;

class Registry {
  entry;
}
const registry = new Registry();
registry.entry = 1;
registry.entry = 'two';

declare const prefetchers: any;
prefetchers.map(prefetch => prefetch(options));
`;

    const result = run(text);

    expect(result).toContain('import { Options } from "./types";\ndeclare const');
    expect(result).toContain(
      'prefetchers.map((prefetch: (arg0: Options) => any) => prefetch(options));',
    );
  });

  it('writes nothing when an import it needs collides with a declaration in the file', () => {
    // An import belongs to no function, so an error written into one reaches
    // none of the grouping that answers for the annotations: it used to ride
    // out of the pass with the rest of the file. Here the file already
    // declares `Options`, so importing the type of that name is a duplicate
    // identifier (TS2440) rather than an import.
    const text = `import { options } from './types';

export interface Options {
  size: number;
}

declare const prefetchers: any;
prefetchers.map(prefetch => prefetch(options));
`;
    const notices: PluginFileNotice[] = [];

    expect(run(text, (notice) => notices.push(notice))).toBeUndefined();
    expect(notices).toEqual([
      {
        reason: 'The imports its annotations need would not compile',
        hint: 'The file keeps the annotations it had; explicit-any fills the rest in with any.',
      },
    ]);
  });

  it('keeps a file whose imports carried an error of their own before the pass', () => {
    // Adding a name reprints the whole declaration, which puts a multi-line
    // clause on one line and moves every name in it. The error the file
    // already had on `NotThere` therefore comes back from the diff looking
    // new, and lands inside the text this pass wrote - the one shape that
    // would otherwise cost the file its annotations for a fault it had all
    // along.
    const text = `import {
  NotThere,
  connect,
} from './types';

export function open(target) {
  connect(target);
  return target.host.length;
}

open(1);
export const missing = NotThere;
`;

    expect(run(text)).toBe(`import { NotThere, connect, Options } from './types';

export function open(target: Options) {
  connect(target);
  return target.host.length;
}

open(1);
export const missing = NotThere;
`);
  });
});
