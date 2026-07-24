import log from 'updatable-log';
import { formatTypeDebtReport, scanTypeDebt } from '../utils/typeDebt';

interface ReportParams {
  rootDir: string;
  folder: string;
  json?: boolean;
  /** Skip gitignored files (default). */
  gitignore?: boolean;
}

export default function report({ rootDir, folder, json, gitignore }: ReportParams): number {
  let debt;
  try {
    debt = scanTypeDebt(rootDir, gitignore);
  } catch (err) {
    log.error(err instanceof Error ? err.message : err);
    return -1;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(debt, null, 2)}\n`);
  } else {
    log.info(formatTypeDebtReport(debt, folder));
  }
  return 0;
}
