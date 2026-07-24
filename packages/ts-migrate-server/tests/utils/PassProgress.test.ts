import log from 'updatable-log';
import PassProgress from '../../src/utils/PassProgress';

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
  });
});
