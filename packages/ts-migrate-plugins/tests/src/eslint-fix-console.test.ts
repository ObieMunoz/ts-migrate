import eslintFixPlugin from '../../src/plugins/eslint-fix';
import { mockPluginParams } from '../test-utils';

// A fake ESLint whose lintText writes to the console the way the code inside a
// real one does: typescript-estree prints its version banner straight to
// stdout the first time it parses, through no ESLint API at all. This is the
// @typescript-eslint 5 wording, whose labels are capitalized differently from
// the ones 8 prints.
jest.mock('eslint', () => {
  const banner = [
    '=============',
    'WARNING: You are currently running a version of TypeScript which is not officially supported by @typescript-eslint/typescript-estree.',
    'You may find that it works just fine, or you may not.',
    'SUPPORTED TYPESCRIPT VERSIONS: >=3.3.1 <5.2.0',
    'YOUR TYPESCRIPT VERSION: 5.7.3',
    'Please only submit bug reports when using the officially supported version.',
    '=============',
  ].join('\n\n');
  const lintText = jest.fn(async (text: string) => {
    console.log(banner);
    return [{ messages: [], output: text }];
  });
  class FakeESLint {
    lintText = lintText;
  }
  return { __esModule: true, loadESLint: async () => FakeESLint, __lintText: lintText };
});

const { __lintText: lintText } = jest.requireMock('eslint') as { __lintText: jest.Mock };

describe('eslint-fix console filter', () => {
  let writes: string[];
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    writes = [];
    const record = (...args: unknown[]) => {
      writes.push(args.map(String).join(' '));
    };
    // info as well as log: the plugin's own banner lines go through
    // updatable-log, which writes with console.info.
    spies = [
      jest.spyOn(console, 'log').mockImplementation(record),
      jest.spyOn(console, 'info').mockImplementation(record),
    ];
  });

  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore());
  });

  it('replaces the typescript-estree version banner with one line naming the skew', async () => {
    const fixed = await eslintFixPlugin.run(
      mockPluginParams({ fileName: '/proj/Foo.tsx', text: 'const a = 1' }),
    );

    expect(fixed).toBe('const a = 1');
    expect(lintText).toHaveBeenCalled();

    const output = writes.join('\n');
    expect(output).not.toContain('WARNING: You are currently running');
    expect(output).not.toContain('=============');

    const summary = writes.filter((line) => line.includes('@typescript-eslint'));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('>=3.3.1 <5.2.0');
    expect(summary[0]).toContain('5.7.3');
  });

  it('reads the versions out of the @typescript-eslint 8 wording too', async () => {
    lintText.mockImplementationOnce(async (text: string) => {
      console.log(
        [
          '=============',
          '',
          'WARNING: You are currently running a version of TypeScript which is not officially supported by @typescript-eslint/typescript-estree.',
          '',
          '* @typescript-eslint/typescript-estree version: 8.63.0',
          '* Supported TypeScript versions: >=4.8.4 <6.1.0',
          '* Your TypeScript version: 6.0.3',
          '',
          'Please only submit bug reports when using the officially supported version.',
          '',
          '=============',
        ].join('\n'),
      );
      return [{ messages: [], output: text }];
    });

    await eslintFixPlugin.run(mockPluginParams({ fileName: '/proj/Qux.tsx', text: 'const d = 4' }));

    const summary = writes.filter((line) => line.includes('@typescript-eslint'));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('>=4.8.4 <6.1.0');
    expect(summary[0]).toContain('6.0.3');
  });

  it('passes through console output it does not recognize', async () => {
    lintText.mockImplementationOnce(async (text: string) => {
      console.log('a rule printed this');
      return [{ messages: [], output: text }];
    });

    await eslintFixPlugin.run(mockPluginParams({ fileName: '/proj/Bar.tsx', text: 'const b = 2' }));

    expect(writes).toContain('a rule printed this');
  });

  it('leaves the console as it found it once the last lint call finishes', async () => {
    await eslintFixPlugin.run(mockPluginParams({ fileName: '/proj/Baz.tsx', text: 'const c = 3' }));

    expect(console.log).toBe(spies[0]);
    expect(console.info).toBe(spies[1]);
  });
});
