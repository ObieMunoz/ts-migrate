import path from 'path';
import fs from 'fs';
import log from 'updatable-log';
import { createDir, copyDir, deleteDir, warningsFrom } from '@obiemunoz/ts-migrate-test-utils';
import migrate, { MigrateConfig } from '../../../src/migrate';

jest.mock('updatable-log', () => {
  const { spyUpdatableLog } = require('@obiemunoz/ts-migrate-test-utils');
  return spyUpdatableLog();
});

const fixturesDir = path.resolve(__dirname, '../../fixtures');

const mockedLog = jest.mocked(log);
const warnings = () => warningsFrom(mockedLog);

describe('plugin file notices', () => {
  let rootDir: string;
  beforeEach(() => {
    jest.clearAllMocks();
    rootDir = createDir();
    copyDir(path.resolve(fixturesDir, 'tsconfig'), rootDir);
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  function writeFiles(names: string[]): void {
    names.forEach((name) => fs.writeFileSync(path.resolve(rootDir, name), 'export {};\n'));
  }

  it('reports one line for a cause every file hit, and records it on the result', async () => {
    writeFiles(['a.ts', 'b.ts', 'c.ts']);

    const config = new MigrateConfig().addPlugin(
      {
        name: 'failing-plugin',
        run({ reportFileNotice }) {
          reportFileNotice?.({ reason: 'the rule threw', ruleId: 'a-rule' });
          return undefined;
        },
      },
      {},
    );

    const { pluginFailures } = await migrate({ rootDir, config });

    expect(warnings()).toEqual([
      '[failing-plugin] 3 file(s) could not be processed and were left unchanged:',
      '[failing-plugin]   3 file(s): the rule threw (rule a-rule). First: a.ts, b.ts, c.ts.',
    ]);
    expect(pluginFailures).toEqual([
      {
        pluginName: 'failing-plugin',
        reason: 'the rule threw',
        ruleId: 'a-rule',
        fileCount: 3,
        files: ['a.ts', 'b.ts', 'c.ts'],
      },
    ]);
  });

  it('merges the same cause across the passes of a repeated plugin group', async () => {
    writeFiles(['a.ts', 'b.ts']);

    let pass = 0;
    const config = new MigrateConfig().addPlugin(
      {
        name: 'flaky-plugin',
        run({ fileName, text, reportFileNotice }) {
          // Changes a.ts on the first pass, so the group runs a second one.
          if (fileName.endsWith('a.ts') && pass === 0) {
            pass += 1;
            reportFileNotice?.({ reason: 'the rule threw' });
            return `${text}// changed\n`;
          }
          reportFileNotice?.({ reason: 'the rule threw' });
          return undefined;
        },
      },
      {},
      { repeatUntilStable: true },
    );

    const { pluginFailures } = await migrate({ rootDir, config });

    expect(pluginFailures).toEqual([
      {
        pluginName: 'flaky-plugin',
        reason: 'the rule threw',
        ruleId: undefined,
        fileCount: 2,
        files: ['a.ts', 'b.ts'],
      },
    ]);
  });

  it('leaves a file it could not process out of the next pass, reported once', async () => {
    writeFiles(['a.ts', 'b.ts']);

    const visited: string[] = [];
    const config = new MigrateConfig().addPlugin(
      {
        name: 'flaky-plugin',
        run({ fileName, text, reportFileNotice }) {
          visited.push(path.basename(fileName));
          if (fileName.endsWith('b.ts')) {
            reportFileNotice?.({ reason: 'the rule threw' });
            return undefined;
          }
          // Changes a.ts once, so the group runs a second pass.
          return text.includes('// changed') ? undefined : `${text}// changed\n`;
        },
      },
      {},
      { repeatUntilStable: true },
    );

    const { pluginFailures } = await migrate({ rootDir, config, incrementalPasses: false });

    expect(visited).toEqual(['a.ts', 'b.ts', 'a.ts']);
    expect(warnings()).toEqual([
      '[flaky-plugin] 1 file(s) could not be processed and were left unchanged:',
      '[flaky-plugin]   1 file(s): the rule threw. First: b.ts.',
    ]);
    expect(pluginFailures).toEqual([
      {
        pluginName: 'flaky-plugin',
        reason: 'the rule threw',
        ruleId: undefined,
        fileCount: 1,
        files: ['b.ts'],
      },
    ]);
  });

  it('hands the file back to the plugin once it has changed since', async () => {
    writeFiles(['a.ts']);

    let attempts = 0;
    let appends = 0;
    const config = new MigrateConfig()
      .addPlugin(
        {
          name: 'failing-plugin',
          run({ reportFileNotice }) {
            attempts += 1;
            reportFileNotice?.({ reason: 'the rule threw' });
            return undefined;
          },
        },
        {},
        { repeatUntilStable: true },
      )
      .addPlugin(
        {
          name: 'appending-plugin',
          run({ text }) {
            if (appends >= 2) return undefined;
            appends += 1;
            return `${text}// appended\n`;
          },
        },
        {},
        { repeatUntilStable: true },
      );

    await migrate({ rootDir, config });

    // The plugin before it rewrote the file each pass, so the cause is worth
    // reaching again; repeating the line that reports it is not.
    expect(attempts).toBe(3);
    expect(warnings()).toEqual([
      '[failing-plugin] 1 file(s) could not be processed and were left unchanged:',
      '[failing-plugin]   1 file(s): the rule threw. First: a.ts.',
    ]);
  });

  it('records a recovered notice for the end of the run instead of warning mid-pass', async () => {
    writeFiles(['a.ts']);

    const config = new MigrateConfig().addPlugin(
      {
        name: 'recovering-plugin',
        run({ reportFileNotice }) {
          reportFileNotice?.({
            reason: 'took the slow path',
            hint: 'Do the thing by hand.',
            recovered: true,
            marked: true,
          });
          return undefined;
        },
      },
      {},
    );

    const { pluginFailures, pluginNotices, exitCode } = await migrate({ rootDir, config });

    // The pass says nothing: 30 plugins each reporting theirs is the wall of
    // warnings this replaced.
    expect(warnings()).toEqual([]);
    expect(pluginFailures).toEqual([]);
    expect(pluginNotices).toEqual([
      {
        pluginName: 'recovering-plugin',
        reason: 'took the slow path',
        hint: 'Do the thing by hand.',
        ruleId: undefined,
        marked: true,
        fileCount: 1,
        files: ['a.ts'],
      },
    ]);
    // A notice is not a failed run; nothing about the exit code changes.
    expect(exitCode).toBe(0);
  });

  it('merges a recovered cause across the passes of a repeated plugin group', async () => {
    writeFiles(['a.ts', 'b.ts']);

    let pass = 0;
    const config = new MigrateConfig().addPlugin(
      {
        name: 'flaky-plugin',
        run({ fileName, text, reportFileNotice }) {
          // Only the second pass marks, so the merged entry has to pick it up.
          reportFileNotice?.({ reason: 'left for a person', recovered: true, marked: pass > 0 });
          if (fileName.endsWith('a.ts') && pass === 0) {
            pass += 1;
            return `${text}// changed\n`;
          }
          return undefined;
        },
      },
      {},
      { repeatUntilStable: true },
    );

    const { pluginNotices } = await migrate({ rootDir, config });

    expect(pluginNotices).toEqual([
      expect.objectContaining({ fileCount: 2, files: ['a.ts', 'b.ts'], marked: true }),
    ]);
  });

  it('reports after the pass, so the progress counter cannot render over it', async () => {
    writeFiles(['a.ts']);

    const config = new MigrateConfig().addPlugin(
      {
        name: 'failing-plugin',
        run({ reportFileNotice }) {
          reportFileNotice?.({ reason: 'the rule threw' });
          return undefined;
        },
      },
      {},
    );

    await migrate({ rootDir, config });

    const order = mockedLog.warn.mock.invocationCallOrder[0];
    mockedLog.clear.mock.invocationCallOrder.forEach((clearOrder) => {
      expect(clearOrder).toBeLessThan(order);
    });
  });
});
