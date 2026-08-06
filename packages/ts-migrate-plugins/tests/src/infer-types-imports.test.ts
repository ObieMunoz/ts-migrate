import path from 'path';
import { fixturePluginParams } from '../test-utils';
import inferTypesPlugin from '../../src/plugins/infer-types';

// A module the file imports a value from and not the type of that value, which
// is the shape an inferred annotation names and the file has no name for.
const rootDir = path.resolve(__dirname, '../fixtures/infer-types');
const entryFile = path.join(rootDir, 'entry.ts');

function run(text: string): string | void {
  return inferTypesPlugin.run(fixturePluginParams({ rootDir, fileName: entryFile, text }));
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
});
