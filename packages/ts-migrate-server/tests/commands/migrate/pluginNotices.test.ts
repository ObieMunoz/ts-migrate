import path from 'path';
import fs from 'fs';
import log from 'updatable-log';
import { createDir, copyDir, deleteDir } from '../../test-utils';
import migrate, { MigrateConfig } from '../../../src/migrate';

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
const warnings = () => mockedLog.warn.mock.calls.map(([message]) => message);

describe('plugin file notices', () => {
  let rootDir: string;
  beforeEach(() => {
    jest.clearAllMocks();
    rootDir = createDir();
    copyDir(path.resolve(__dirname, 'config'), rootDir);
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

  it('leaves a recovered notice out of the failures the run records', async () => {
    writeFiles(['a.ts']);

    const config = new MigrateConfig().addPlugin(
      {
        name: 'recovering-plugin',
        run({ reportFileNotice }) {
          reportFileNotice?.({ reason: 'took the slow path', recovered: true });
          return undefined;
        },
      },
      {},
    );

    const { pluginFailures, exitCode } = await migrate({ rootDir, config });

    expect(warnings()).toEqual([
      '[recovering-plugin] 1 file(s): took the slow path. First: a.ts.',
    ]);
    expect(pluginFailures).toEqual([]);
    // A notice is not a failed run; nothing about the exit code changes.
    expect(exitCode).toBe(0);
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
