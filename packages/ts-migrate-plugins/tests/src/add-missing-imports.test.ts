import ts from 'typescript';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import addMissingImportsPlugin from '../../src/plugins/add-missing-imports';
import { realPluginParams, withoutMarkers } from '../test-utils';

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX,
};

interface RunParams {
  text: string;
  fileName?: string;
  extraFiles?: { [fileName: string]: string };
  options?: { ambiguous?: 'first' | 'skip'; moduleSpecifier?: 'relative' | 'non-relative' };
  /** Merged over the defaults above, for the resolution a case needs. */
  compilerOptions?: ts.CompilerOptions;
}

async function run({
  text,
  fileName = 'file.ts',
  extraFiles,
  options = {},
  compilerOptions: overrides,
}: RunParams) {
  const notices: PluginFileNotice[] = [];
  const params = await realPluginParams({
    text,
    fileName,
    options,
    compilerOptions: { ...compilerOptions, ...overrides },
    extraFiles,
  });
  const result = await addMissingImportsPlugin.run({
    ...params,
    reportFileNotice: (notice) => notices.push(notice),
  });
  return { result, notices };
}

describe('add-missing-imports plugin', () => {
  it('imports a name from the one module that exports it', async () => {
    const { result, notices } = await run({
      text: `export const label = formatLabel('save');\n`,
      extraFiles: { 'formatLabel.ts': 'export function formatLabel(key: string) { return key; }\n' },
    });

    expect(result).toBe(`import { formatLabel } from "./formatLabel";

export const label = formatLabel('save');
`);
    expect(notices).toEqual([]);
  });

  it('leaves a name no module exports for ts-ignore to suppress', async () => {
    const text = `export const value = nothingExportsThis;\n`;
    const { result, notices } = await run({ text });

    expect(result).toBe(text);
    expect(notices).toEqual([]);
  });

  it('merges names from one module into a single statement', async () => {
    const { result } = await run({
      text: `export const total = alpha + beta;\n`,
      extraFiles: { 'two.ts': 'export const alpha = 1;\nexport const beta = 2;\n' },
    });

    expect(result).toBe(`import { alpha, beta } from "./two";

export const total = alpha + beta;
`);
  });

  it('extends an import the file already has', async () => {
    const { result } = await run({
      text: `import { alpha } from './two';

export const total = alpha + beta;
`,
      extraFiles: { 'two.ts': 'export const alpha = 1;\nexport const beta = 2;\n' },
    });

    expect(result).toBe(`import { alpha, beta } from './two';

export const total = alpha + beta;
`);
  });

  it('imports a default export under the name the file uses', async () => {
    const { result } = await run({
      text: `export const rendered = Spinner;\n`,
      extraFiles: { 'Spinner.ts': 'export default function Spinner() {}\n' },
    });

    expect(result).toBe(`import Spinner from "./Spinner";

export const rendered = Spinner;
`);
  });

  it('treats a module and the barrel that re-exports it as one candidate', async () => {
    const { result, notices } = await run({
      text: `export const rendered = Widget;\n`,
      extraFiles: {
        'barrel/Widget.ts': 'export const Widget = 1;\n',
        'barrel/index.ts': "export { Widget } from './Widget';\n",
      },
    });

    expect(withoutMarkers(result)).toBe(`import { Widget } from "./barrel";

export const rendered = Widget;
`);
    // One export reached two ways is one home, so nothing is left to review.
    expect(result).not.toContain('TODO(ts-migrate)');
    expect(notices).toEqual([]);
  });

  describe('a name several modules export', () => {
    const extraFiles = {
      'components/Button.ts': 'export const Button = 1;\n',
      'widgets/Button.ts': 'export const Button = 2;\n',
    };
    const text = `export const rendered = Button;\n`;

    it('takes the module TypeScript ranks first and marks the import', async () => {
      const { result, notices } = await run({ text, extraFiles });

      expect(result).toMatchInlineSnapshot(`
        "// TODO(ts-migrate): Check that this import is the one meant; TypeScript offered the name from
        // several modules.
        // Button was taken from ./components/Button, over ./widgets/Button.
        import { Button } from "./components/Button";

        export const rendered = Button;
        "
      `);
      expect(notices).toEqual([
        expect.objectContaining({
          reason: 'imported a name TypeScript offered from more than one module',
          recovered: true,
          marked: true,
        }),
      ]);
    });

    it('leaves it alone under ambiguous: skip', async () => {
      const { result, notices } = await run({ text, extraFiles, options: { ambiguous: 'skip' } });

      expect(result).toBe(text);
      expect(notices).toEqual([
        expect.objectContaining({
          reason: 'left a name TypeScript offered from more than one module unimported',
          recovered: true,
        }),
      ]);
    });

    it('still imports the unambiguous names beside it under ambiguous: skip', async () => {
      const { result } = await run({
        text: `export const rendered = [Button, alpha];\n`,
        extraFiles: {
          'components/Button.ts': 'export const Button = 1;\nexport const alpha = 3;\n',
          'widgets/Button.ts': 'export const Button = 2;\n',
        },
        options: { ambiguous: 'skip' },
      });

      // Both names come from the module TypeScript ranks first, so the fix
      // merges them and only the ambiguous one comes back out.
      expect(result).toBe(`import { alpha } from "./components/Button";

export const rendered = [Button, alpha];
`);
    });
  });

  it('writes the specifier style the options ask for', async () => {
    const params = {
      text: `export const label = formatLabel('save');\n`,
      extraFiles: {
        'utils/formatLabel.ts': 'export function formatLabel(key: string) { return key; }\n',
      },
      compilerOptions: { baseUrl: '/' },
    };

    const relative = await run({ ...params, options: { moduleSpecifier: 'relative' } });
    expect(relative.result).toContain('import { formatLabel } from "./utils/formatLabel"');

    const nonRelative = await run({ ...params, options: { moduleSpecifier: 'non-relative' } });
    expect(nonRelative.result).toContain('import { formatLabel } from "utils/formatLabel"');
  });

  it('reports invalid options', () => {
    expect(() => addMissingImportsPlugin.validate?.({ ambiguous: 'maybe' })).toThrow();
    expect(addMissingImportsPlugin.validate?.({ ambiguous: 'skip' })).toBe(true);
  });
});
