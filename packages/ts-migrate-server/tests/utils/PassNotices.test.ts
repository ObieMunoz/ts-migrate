import path from 'path';
import log from 'updatable-log';
import PassNotices from '../../src/utils/PassNotices';

jest.mock('updatable-log', () => ({
  error: jest.fn(),
  important: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  update: jest.fn(),
  clear: jest.fn(),
  quiet: false,
}));

const mockedLog = jest.mocked(log);
const rootDir = path.join(path.sep, 'project');
const file = (name: string) => path.join(rootDir, name);
const warnings = () => mockedLog.warn.mock.calls.map(([message]) => message);

describe('PassNotices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports one line for a cause every file hit', () => {
    const notices = new PassNotices(rootDir);
    ['a.ts', 'b.ts', 'c.ts', 'd.ts'].forEach((name) =>
      notices.add(file(name), {
        reason: 'context.getScope is not a function',
        ruleId: 'no-unused-vars',
      }),
    );

    notices.report('[eslint-fix]');

    expect(warnings()).toEqual([
      '[eslint-fix] 4 file(s) could not be processed and were left unchanged:',
      '[eslint-fix]   4 file(s): context.getScope is not a function (rule no-unused-vars). ' +
        'First: a.ts, b.ts, c.ts, and 1 more.',
    ]);
  });

  it('groups by cause and rule, largest group first, and prints each hint once', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('a.ts'), { reason: 'parse error', hint: 'add a parser' });
    notices.add(file('b.ts'), { reason: 'rule threw', ruleId: 'r' });
    notices.add(file('c.ts'), { reason: 'parse error', hint: 'add a parser' });

    notices.report('[eslint-fix]');

    expect(warnings()).toEqual([
      '[eslint-fix] 3 file(s) could not be processed and were left unchanged:',
      '[eslint-fix]   2 file(s): parse error. First: a.ts, c.ts.',
      '[eslint-fix]     add a parser',
      '[eslint-fix]   1 file(s): rule threw (rule r). First: b.ts.',
    ]);
  });

  it('counts a file once when two causes hit it', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('a.ts'), { reason: 'first' });
    notices.add(file('a.ts'), { reason: 'second' });

    expect(notices.failedFileCount()).toBe(1);
  });

  it('reports a recovered notice without counting the file as unchanged', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('src/a.ts'), { reason: 'linted in-process', recovered: true });

    notices.report('[eslint-fix]');

    expect(notices.failedFileCount()).toBe(0);
    expect(warnings()).toEqual(['[eslint-fix] 1 file(s): linted in-process. First: src/a.ts.']);
  });

  it('prints nothing when nothing was reported', () => {
    new PassNotices(rootDir).report('[eslint-fix]');

    expect(mockedLog.warn).not.toHaveBeenCalled();
  });

  it('caps the causes it prints and says how many it left out', () => {
    const notices = new PassNotices(rootDir);
    for (let i = 0; i < 12; i += 1) {
      notices.add(file(`file${i}.ts`), { reason: `cause ${i}` });
    }

    notices.report('[p]');

    expect(warnings()).toHaveLength(12);
    expect(warnings()[11]).toBe('[p] and 2 more distinct cause(s).');
  });

  it('exposes the groups with rootDir-relative, sorted file names', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file(path.join('src', 'b.ts')), { reason: 'boom', ruleId: 'r' });
    notices.add(file(path.join('src', 'a.ts')), { reason: 'boom', ruleId: 'r' });

    expect(notices.groups()).toEqual([
      {
        reason: 'boom',
        ruleId: 'r',
        hint: undefined,
        recovered: false,
        fileCount: 2,
        files: ['src/a.ts', 'src/b.ts'],
      },
    ]);
  });
});
