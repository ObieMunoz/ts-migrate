import path from 'path';
import { formatGeneratedFileLintReport } from '../../utils/runReports';

const rootDir = path.join('/repo', 'packages', 'app');

describe('formatGeneratedFileLintReport', () => {
  it('prints nothing when the project ESLint reads every generated file', () => {
    expect(formatGeneratedFileLintReport([], rootDir, false)).toBeNull();
  });

  it("names each file relative to the migration root, with ESLint's own message", () => {
    const report = formatGeneratedFileLintReport(
      [
        {
          filePath: path.join(rootDir, 'types', 'ts-migrate-globals.d.ts'),
          message: 'Parsing error: Unexpected token global',
        },
        {
          filePath: path.join(rootDir, 'ts-migrate-aliases.d.ts'),
          message: 'Parsing error: Unexpected token TsMigrateAny',
        },
      ],
      rootDir,
      false,
    ) as string;

    expect(report).toContain('cannot parse 2 generated declaration files');
    expect(report).toContain(
      `  ${path.join('types', 'ts-migrate-globals.d.ts')}: Parsing error: Unexpected token global`,
    );
    expect(report).toContain('ts-migrate-aliases.d.ts: Parsing error: Unexpected token TsMigrateAny');
    expect(report).not.toContain(rootDir);
  });

  it('says the compiler is unaffected, and that a disable comment is not the answer', () => {
    const report = formatGeneratedFileLintReport(
      [{ filePath: path.join(rootDir, 'types', 'x.d.ts'), message: 'Parsing error: boom' }],
      rootDir,
      false,
    ) as string;

    expect(report).toContain('1 generated declaration file:');
    expect(report).toContain('The compiler reads them');
    expect(report).toContain('no eslint-disable comment');
    expect(report).toContain('TypeScript parser');
  });

  it('speaks of a file a real run would write when nothing was written', () => {
    const report = formatGeneratedFileLintReport(
      [{ filePath: path.join(rootDir, 'types', 'x.d.ts'), message: 'Parsing error: boom' }],
      rootDir,
      true,
    ) as string;

    expect(report).toContain('a real run would write');
  });
});
