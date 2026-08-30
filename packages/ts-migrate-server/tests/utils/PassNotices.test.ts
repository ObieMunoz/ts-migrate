import path from 'path';
import log from 'updatable-log';
import { warningsFrom } from '@obiemunoz/ts-migrate-test-utils';
import PassNotices from '../../src/utils/PassNotices';

jest.mock('updatable-log', () => {
  const { spyUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return spyUpdatableLog();
});

const mockedLog = jest.mocked(log);
const rootDir = path.join(path.sep, 'project');
const file = (name: string) => path.join(rootDir, name);
const warnings = () => warningsFrom(mockedLog);

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

  it('keeps a recovered notice out of the pass report, for the run to report at the end', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('src/a.ts'), { reason: 'linted in-process', recovered: true });

    notices.report('[eslint-fix]');

    expect(notices.failedFileCount()).toBe(0);
    expect(mockedLog.warn).not.toHaveBeenCalled();
    expect(notices.groups()).toEqual([
      expect.objectContaining({ reason: 'linted in-process', recovered: true, fileCount: 1 }),
    ]);
  });

  it('reports the failures in a pass that also recovered from something', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('a.ts'), { reason: 'left for a person', recovered: true });
    notices.add(file('b.ts'), { reason: 'the rule threw' });

    notices.report('[p]');

    expect(warnings()).toEqual([
      '[p] 1 file(s) could not be processed and were left unchanged:',
      '[p]   1 file(s): the rule threw. First: b.ts.',
    ]);
  });

  it('marks a group when any of its files had its site marked in place', () => {
    const notices = new PassNotices(rootDir);
    notices.add(file('a.ts'), { reason: 'left for a person', recovered: true });
    notices.add(file('b.ts'), { reason: 'left for a person', recovered: true, marked: true });

    expect(notices.groups()[0].marked).toBe(true);
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

  it('leaves out what an earlier pass reported for the same file', () => {
    const reported = new Set<string>();
    const first = new PassNotices(rootDir, reported);
    first.add(file('a.ts'), { reason: 'boom' });
    first.report('[p]');

    const second = new PassNotices(rootDir, reported);
    second.add(file('a.ts'), { reason: 'boom' });
    second.add(file('b.ts'), { reason: 'boom' });
    second.report('[p]');

    expect(warnings()).toEqual([
      '[p] 1 file(s) could not be processed and were left unchanged:',
      '[p]   1 file(s): boom. First: a.ts.',
      '[p] 1 file(s) could not be processed and were left unchanged:',
      '[p]   1 file(s): boom. First: b.ts.',
    ]);
  });

  it('prints nothing for a pass that repeats what the pass before it reported', () => {
    const reported = new Set<string>();
    const first = new PassNotices(rootDir, reported);
    first.add(file('a.ts'), { reason: 'boom' });
    first.report('[p]');
    mockedLog.warn.mockClear();

    const second = new PassNotices(rootDir, reported);
    second.add(file('a.ts'), { reason: 'boom' });
    second.report('[p]');

    expect(mockedLog.warn).not.toHaveBeenCalled();
  });

  it('still reports a file an earlier pass reported for a different cause', () => {
    const reported = new Set<string>();
    const first = new PassNotices(rootDir, reported);
    first.add(file('a.ts'), { reason: 'boom' });
    first.report('[p]');
    mockedLog.warn.mockClear();

    const second = new PassNotices(rootDir, reported);
    second.add(file('a.ts'), { reason: 'a different boom' });
    second.report('[p]');

    expect(warnings()).toEqual([
      '[p] 1 file(s) could not be processed and were left unchanged:',
      '[p]   1 file(s): a different boom. First: a.ts.',
    ]);
  });

  it('exposes every group it collected, reported before or not', () => {
    const reported = new Set<string>();
    const first = new PassNotices(rootDir, reported);
    first.add(file('a.ts'), { reason: 'boom' });
    first.report('[p]');

    const second = new PassNotices(rootDir, reported);
    second.add(file('a.ts'), { reason: 'boom' });

    expect(second.groups()).toEqual([
      {
        reason: 'boom',
        ruleId: undefined,
        hint: undefined,
        recovered: false,
        marked: false,
        fileCount: 1,
        files: ['a.ts'],
      },
    ]);
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
        marked: false,
        fileCount: 2,
        files: ['src/a.ts', 'src/b.ts'],
      },
    ]);
  });
});
