import { importChangesFor, withImportChanges } from '../../src/plugins/utils/annotationImports';
import { applyTextChanges, TextChange } from '../../src/utils/candidateValidation';
import { InferredImport } from '../../src/utils/inferFromUsage';

const fileName = '/file.ts';

const serverOptions: InferredImport = {
  name: 'ServerOptions',
  moduleSpecifier: './lib',
  isDefault: false,
  isTypeOnly: false,
};

// `: ServerOptions` at the end of a parameter name, which is where the
// inference engine writes one.
function annotation(text: string, name: string, type: string): TextChange {
  return { start: text.indexOf(name) + name.length, length: 0, text: `: ${type}` };
}

describe('the imports an annotated file needs', () => {
  it('writes the import the annotations name, applied alongside them', () => {
    const text = `import { serve } from './lib';

export function run(options) {
  serve(options);
}
`;
    const annotations = [annotation(text, 'run(options', 'ServerOptions')];

    expect(applyTextChanges(text, withImportChanges(fileName, text, annotations, [serverOptions])))
      .toBe(`import { serve, ServerOptions } from './lib';

export function run(options: ServerOptions) {
  serve(options);
}
`);
  });

  it('writes nothing for an import no annotation kept ended up naming', () => {
    const text = `import { serve } from './lib';

export function run(options) {
  serve(options);
}
`;
    const annotations = [annotation(text, 'run(options', 'string')];

    expect(importChangesFor(fileName, text, annotations, [serverOptions])).toEqual([]);
  });

  it('writes nothing for a name the file already imports', () => {
    const text = `import { serve, ServerOptions } from './lib';

export function run(options) {
  serve(options);
}
`;
    const annotations = [annotation(text, 'run(options', 'ServerOptions')];

    expect(importChangesFor(fileName, text, annotations, [serverOptions])).toEqual([]);
  });

  it('writes nothing when the engine reported no imports', () => {
    const text = `export function run(options) {
  return options;
}
`;
    const annotations = [annotation(text, 'run(options', 'string')];

    expect(importChangesFor(fileName, text, annotations, [])).toEqual([]);
  });
});
