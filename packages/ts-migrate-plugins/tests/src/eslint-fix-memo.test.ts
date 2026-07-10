import eslintFixPlugin from '../../src/plugins/eslint-fix';
import { mockPluginParams } from '../test-utils';

// A fake ESLint whose autofix appends a single semicolon and then stabilizes,
// so the memo can be exercised by counting lintText calls without loading a
// real (flat) config in the jest sandbox.
jest.mock('eslint', () => {
  const lintText = jest.fn(async (text: string) => [
    { messages: [], output: text.endsWith(';') ? text : `${text};` },
  ]);
  class FakeESLint {
    lintText = lintText;
  }
  return { __esModule: true, loadESLint: async () => FakeESLint, __lintText: lintText };
});

const { __lintText: lintText } = jest.requireMock('eslint') as { __lintText: jest.Mock };

describe('eslint-fix idempotency memo', () => {
  it('skips re-linting a file whose text is unchanged since its last fix', async () => {
    const fileName = '/proj/Foo.tsx';

    const first = await eslintFixPlugin.run(mockPluginParams({ fileName, text: 'const a = 1' }));
    expect(first).toBe('const a = 1;');
    const callsAfterFirst = lintText.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // ts-ignore left this file untouched, so the second eslint-fix pass sees the
    // exact text the first pass produced — a known fixed point — and skips it.
    const second = await eslintFixPlugin.run(
      mockPluginParams({ fileName, text: first as string }),
    );
    expect(second).toBe(first);
    expect(lintText.mock.calls.length).toBe(callsAfterFirst);

    // A file it has not fixed yet still runs through ESLint.
    await eslintFixPlugin.run(mockPluginParams({ fileName: '/proj/Bar.tsx', text: 'const b = 2' }));
    expect(lintText.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
