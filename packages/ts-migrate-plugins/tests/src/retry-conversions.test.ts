import ts from 'typescript';
import { mockPluginParams, realPluginParams } from '../test-utils';
import retryConversionsPlugin from '../../src/plugins/retry-conversions';

async function run(text: string, compilerOptions?: ts.CompilerOptions): Promise<string | void> {
  return retryConversionsPlugin.run(await realPluginParams({ text, compilerOptions }));
}

describe('retry-conversions plugin', () => {
  it('drops an assertion the checker no longer needs, with its parentheses', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
`;

    expect(await run(text)).toBe(`interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
`);
  });

  it('restores a load-bearing assertion byte for byte', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export function read(fallback: string) {
  switch   (fallback) {
    default:
      return (widget as any).notDeclared;
  }
}
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps a removable assertion and restores the one beside it', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
export const missing = (widget as any).notDeclared;
`;

    expect(await run(text)).toBe(`interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
export const missing = (widget as any).notDeclared;
`);
  });

  it('leaves a user written assertion alone', async () => {
    const text = `declare const value: unknown;

export const text = value as string;
export const length = (value as string).length;
`;

    expect(await run(text)).toBe(text);
  });

  it('drops an assertion to an alias the project declares as any', async () => {
    const text = `type $TSFixMe = any;

interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as $TSFixMe).name;
`;

    expect(await run(text)).toBe(`type $TSFixMe = any;

interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = widget.name;
`);
  });

  it('leaves an assertion to an alias that is not any alone', async () => {
    const text = `type Loose = string;

declare const value: string;

export const upper = (value as Loose).toUpperCase();
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the parentheses around an optional chain', async () => {
    const text = `declare const outer: { inner?: { name: string } };

export const name = (outer.inner?.name as any) ?? '';
`;

    expect(await run(text)).toBe(`declare const outer: { inner?: { name: string } };

export const name = (outer.inner?.name) ?? '';
`);
  });

  it('changes nothing on a second run', async () => {
    const text = `interface Widget {
  name: string;
}
declare const widget: Widget;

export const name = (widget as any).name;
export const missing = (widget as any).notDeclared;
`;

    const once = await run(text);
    expect(typeof once).toBe('string');
    expect(await run(once as string)).toBe(once);
  });

  it('does not query the language service for a file with no assertion', async () => {
    const params = mockPluginParams({
      text: 'export const answer = 42;\n',
    });
    const result = retryConversionsPlugin.run({
      ...params,
      getLanguageService: () => {
        throw new Error('the language service must not be queried');
      },
    });

    expect(result).toBe('export const answer = 42;\n');
  });
});
