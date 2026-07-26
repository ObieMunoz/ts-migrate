import { MigrateResult } from '@obiemunoz/ts-migrate-server';
import formatFollowUpReport from '../../utils/followUpReport';

type Notice = MigrateResult['pluginNotices'][number];

const notice = (overrides: Partial<Notice> & Pick<Notice, 'pluginName' | 'files'>): Notice => ({
  reason: 'a cause',
  marked: true,
  fileCount: overrides.files.length,
  ...overrides,
});

describe('formatFollowUpReport', () => {
  it('prints nothing when the run left nothing behind', () => {
    expect(formatFollowUpReport([])).toBeNull();
  });

  it('counts files once across the causes that share them', () => {
    const report = formatFollowUpReport([
      notice({ pluginName: 'p', reason: 'first', files: ['a.ts', 'b.ts'] }),
      notice({ pluginName: 'p', reason: 'second', files: ['b.ts', 'c.ts'] }),
    ]) as string;

    expect(report).toContain('Follow-up notices: 3 files across 1 plugin.');
    expect(report).toContain('  p  3 files, 2 causes');
  });

  it('names no file, whatever the cause', () => {
    const files = Array.from({ length: 40 }, (_unused, i) => `app/components/Thing${i}.tsx`);
    const report = formatFollowUpReport([notice({ pluginName: 'p', files })]) as string;

    files.forEach((file) => expect(report).not.toContain(file));
  });

  it('orders plugins by how much they left, and prints each remedy once', () => {
    const report = formatFollowUpReport([
      notice({ pluginName: 'jsdoc', files: ['a.ts'], hint: 'Annotate it.' }),
      notice({
        pluginName: 'react-default-props',
        reason: 'not a literal',
        files: ['b.tsx', 'c.tsx'],
        hint: 'Convert it.',
      }),
      notice({
        pluginName: 'react-default-props',
        reason: 'not destructured',
        files: ['d.tsx'],
        hint: 'Convert it.',
      }),
    ]) as string;

    expect(report).toBe(
      [
        'Follow-up notices: 4 files across 2 plugins.',
        '',
        '  react-default-props  3 files, 2 causes',
        '    Convert it.',
        '',
        '  jsdoc  1 file, 1 cause',
        '    Annotate it.',
        '',
        '  Each site is marked in place: grep -rn "TODO(ts-migrate)"',
      ].join('\n'),
    );
  });

  it('leaves out the grep when nothing was marked in place', () => {
    const report = formatFollowUpReport([
      notice({ pluginName: 'eslint-fix', files: ['a.ts'], marked: false }),
    ]) as string;

    expect(report).not.toContain('grep');
    expect(report).toContain('  eslint-fix  1 file, 1 cause');
  });
});
