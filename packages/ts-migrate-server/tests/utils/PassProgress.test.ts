import log from 'updatable-log';
import PassProgress from '../../src/utils/PassProgress';

jest.mock('updatable-log', () => {
  const { spyUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return spyUpdatableLog();
});

const mockedLog = jest.mocked(log);

function makeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('PassProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('on a TTY', () => {
    it('shows the current file immediately and throttles re-renders', () => {
      const clock = makeClock();
      const progress = new PassProgress({
        prefix: '[p]',
        total: 3,
        showCurrentFile: true,
        isTTY: true,
        now: clock.now,
      });

      progress.fileStarted('a.ts');
      expect(mockedLog.update).toHaveBeenCalledWith('[p] 1/3 a.ts');

      progress.fileFinished();
      clock.advance(100);
      progress.fileStarted('b.ts');
      expect(mockedLog.update).toHaveBeenCalledTimes(1);

      progress.fileFinished();
      clock.advance(300);
      progress.fileStarted('c.ts');
      expect(mockedLog.update).toHaveBeenLastCalledWith('[p] 3/3 c.ts');
      expect(mockedLog.info).not.toHaveBeenCalled();
    });

    it('shows a bare completion counter for a concurrent pass', () => {
      const clock = makeClock();
      const progress = new PassProgress({
        prefix: '[p]',
        total: 2,
        showCurrentFile: false,
        isTTY: true,
        now: clock.now,
      });

      progress.fileStarted('a.ts');
      progress.fileStarted('b.ts');
      expect(mockedLog.update).not.toHaveBeenCalled();

      progress.fileFinished();
      expect(mockedLog.update).toHaveBeenCalledWith('[p] 1/2 files processed');

      clock.advance(300);
      progress.fileFinished();
      expect(mockedLog.update).toHaveBeenLastCalledWith('[p] 2/2 files processed');
    });

    it('truncates a long path so the counter stays on one row', () => {
      const relFile = `src/${'deeply/nested/'.repeat(6)}Component.tsx`;
      const progress = new PassProgress({
        prefix: '[infer-types]',
        total: 340,
        showCurrentFile: true,
        isTTY: true,
        now: () => 0,
        columns: () => 80,
      });

      progress.fileStarted(relFile);

      const line = mockedLog.update.mock.calls[0][0] as string;
      expect(line).toBe(`[infer-types] 1/340 ...${relFile.slice(-53)}`);
      expect(line).toHaveLength(76);
    });

    it('leaves a path that already fits alone', () => {
      const progress = new PassProgress({
        prefix: '[p]',
        total: 3,
        showCurrentFile: true,
        isTTY: true,
        now: () => 0,
        columns: () => 80,
      });

      progress.fileStarted('src/a.ts');
      expect(mockedLog.update).toHaveBeenCalledWith('[p] 1/3 src/a.ts');
    });

    it('names a file that took longer than the slow-file threshold', () => {
      const clock = makeClock();
      const progress = new PassProgress({
        prefix: '[infer-types]',
        total: 2,
        showCurrentFile: true,
        isTTY: true,
        now: clock.now,
      });

      progress.fileStarted('src/fast.ts');
      clock.advance(1_000);
      progress.fileFinished();
      expect(mockedLog.info).not.toHaveBeenCalled();

      progress.fileStarted('src/slow.ts');
      clock.advance(252_000);
      progress.fileFinished();
      expect(mockedLog.info).toHaveBeenCalledTimes(1);
      expect(mockedLog.info).toHaveBeenCalledWith('[infer-types] src/slow.ts took 4m 12s.');
    });

    it('reports no slow file for a concurrent pass', () => {
      const clock = makeClock();
      const progress = new PassProgress({
        prefix: '[eslint-fix]',
        total: 2,
        showCurrentFile: false,
        isTTY: true,
        now: clock.now,
      });

      progress.fileStarted('a.ts');
      progress.fileStarted('b.ts');
      clock.advance(252_000);
      progress.fileFinished();
      progress.fileFinished();
      expect(mockedLog.info).not.toHaveBeenCalled();
    });

    it('clears the counter line when the pass finishes', () => {
      const progress = new PassProgress({
        prefix: '[p]',
        total: 1,
        showCurrentFile: true,
        isTTY: true,
        now: () => 0,
      });

      progress.finish();
      expect(mockedLog.clear).toHaveBeenCalled();
    });
  });

  describe('without a TTY', () => {
    it('logs plain lines at most once per interval and none for a short pass', () => {
      const clock = makeClock(1_000);
      const progress = new PassProgress({
        prefix: '[p]',
        total: 100,
        showCurrentFile: true,
        isTTY: false,
        now: clock.now,
      });

      progress.fileStarted('a.ts');
      progress.fileFinished();
      expect(mockedLog.info).not.toHaveBeenCalled();

      clock.advance(10_000);
      progress.fileStarted('b.ts');
      expect(mockedLog.info).toHaveBeenCalledWith('[p] 2/100 b.ts');

      progress.fileFinished();
      clock.advance(9_999);
      progress.fileStarted('c.ts');
      expect(mockedLog.info).toHaveBeenCalledTimes(1);
      expect(mockedLog.update).not.toHaveBeenCalled();
    });

    it('keeps the whole path in a plain line', () => {
      const clock = makeClock(1_000);
      const relFile = `src/${'deeply/nested/'.repeat(6)}Component.tsx`;
      const progress = new PassProgress({
        prefix: '[infer-types]',
        total: 100,
        showCurrentFile: true,
        isTTY: false,
        now: clock.now,
        columns: () => 80,
      });

      clock.advance(10_000);
      progress.fileStarted(relFile);
      expect(mockedLog.info).toHaveBeenCalledWith(`[infer-types] 1/100 ${relFile}`);
    });
  });
});
