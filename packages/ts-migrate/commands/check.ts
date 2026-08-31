import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import { errorMessage } from '@obiemunoz/ts-migrate-server';
import { DEBT_KEYS, DebtKey, debtTotal, scanTypeDebt } from '../utils/typeDebt';

export const DEFAULT_BASELINE_FILE = '.ts-migrate-baseline.json';

const BASELINE_VERSION = 1;

const COUNTER_LABELS: Record<DebtKey, string> = {
  tsExpectError: '@ts-expect-error',
  tsIgnore: '@ts-ignore',
  anyAlias: 'any-alias',
  any: 'explicit any',
};

type BaselineCounts = Record<DebtKey, number>;

interface Baseline {
  version: number;
  files: Record<string, BaselineCounts>;
}

interface CheckParams {
  rootDir: string;
  folder: string;
  updateBaseline?: boolean;
  baselineFile?: string;
  /** Skip gitignored files (default). */
  gitignore?: boolean;
}

function toBaselineCounts(counts: BaselineCounts): BaselineCounts {
  return Object.fromEntries(DEBT_KEYS.map((key) => [key, counts[key]] as const)) as BaselineCounts;
}

function sortedFiles(files: Record<string, BaselineCounts>): Record<string, BaselineCounts> {
  const sorted: Record<string, BaselineCounts> = {};
  Object.keys(files)
    .sort()
    .forEach((file) => {
      sorted[file] = toBaselineCounts(files[file]);
    });
  return sorted;
}

/**
 * Writes the baseline, reporting a failure the way the read below it does
 * rather than letting one reach the process. The path can come from
 * --baselineFile, and a parent directory that does not exist or a checkout the
 * job cannot write to is a bad argument, not a bug in ts-migrate. Returns the
 * message to report, or undefined on success: the two paths that write to
 * deliver the baseline treat a failure as fatal, and the one that lowers an
 * existing baseline does not.
 */
function writeBaseline(
  baselinePath: string,
  files: Record<string, BaselineCounts>,
): string | undefined {
  const baseline: Baseline = { version: BASELINE_VERSION, files: sortedFiles(files) };
  try {
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    return undefined;
  } catch (err) {
    return `Could not write baseline ${baselinePath}: ${errorMessage(err)}`;
  }
}

function readBaseline(baselinePath: string): Baseline {
  let parsed: Baseline;
  try {
    parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  } catch (err) {
    throw new Error(`Could not read baseline ${baselinePath}: ${errorMessage(err)}`);
  }
  if (parsed?.version !== BASELINE_VERSION || typeof parsed.files !== 'object') {
    throw new Error(
      `Unsupported baseline format in ${baselinePath}. Re-create it with --updateBaseline.`,
    );
  }
  return parsed;
}

/**
 * Ratchet mode of the type debt scanner: exits nonzero if any per-file count
 * exceeds the committed baseline, and lowers the baseline on improvement.
 */
export default function check({
  rootDir,
  folder,
  updateBaseline,
  baselineFile,
  gitignore,
}: CheckParams): number {
  const baselinePath = baselineFile
    ? path.resolve(process.cwd(), baselineFile)
    : path.join(rootDir, DEFAULT_BASELINE_FILE);
  const relativePath = path.relative(process.cwd(), baselinePath);
  const displayPath = relativePath && !relativePath.startsWith('..') ? relativePath : baselinePath;

  let current: Record<string, BaselineCounts>;
  let totalDebt: number;
  let filesScanned: number;
  try {
    const report = scanTypeDebt(rootDir, gitignore);
    current = {};
    Object.entries(report.files).forEach(([file, debt]) => {
      current[file] = toBaselineCounts(debt);
    });
    totalDebt = debtTotal(report.totals);
    filesScanned = report.filesScanned;
  } catch (err) {
    log.error(errorMessage(err));
    return -1;
  }

  const deliverBaseline = (): boolean => {
    const writeError = writeBaseline(baselinePath, current);
    if (writeError) {
      log.error(writeError);
      return false;
    }
    return true;
  };

  if (updateBaseline) {
    if (!deliverBaseline()) return -1;
    log.info(`Baseline updated: ${displayPath}. Commit it.`);
    return 0;
  }

  if (!fs.existsSync(baselinePath)) {
    if (!deliverBaseline()) return -1;
    log.info(
      `No baseline found; wrote ${displayPath} (${Object.keys(current).length} files with debt). ` +
        `Commit it; later runs exit nonzero if any per-file count grows.`,
    );
    return 0;
  }

  let baseline: Baseline;
  try {
    baseline = readBaseline(baselinePath);
  } catch (err) {
    log.error(errorMessage(err));
    return -1;
  }

  const regressions: string[] = [];
  Object.entries(current).forEach(([file, counts]) => {
    const base = baseline.files[file];
    DEBT_KEYS.forEach((key) => {
      const allowed = base?.[key] ?? 0;
      if (counts[key] > allowed) {
        regressions.push(`  ${file}: ${COUNTER_LABELS[key]} ${allowed} -> ${counts[key]}`);
      }
    });
  });

  if (regressions.length > 0) {
    log.error(
      [
        `Type debt increased over the baseline (${displayPath}):`,
        ...regressions,
        `Remove the new suppressions or any-type annotations, or accept them with ` +
          `\`ts-migrate check ${folder} --updateBaseline\`.`,
      ].join('\n'),
    );
    return 1;
  }

  const normalizedBaseline = JSON.stringify(sortedFiles(baseline.files));
  const normalizedCurrent = JSON.stringify(sortedFiles(current));
  if (normalizedBaseline !== normalizedCurrent) {
    // The ratchet has already passed here: no per-file count grew. A baseline
    // that could not be lowered is stale rather than wrong, and the next run
    // still passes against it, so this does not fail the run.
    const writeError = writeBaseline(baselinePath, current);
    if (writeError) {
      log.warn(`${writeError}. Type debt improved, so the baseline is now higher than the code.`);
    } else {
      log.info(`Type debt improved; baseline lowered. Commit the updated ${displayPath}.`);
    }
  } else {
    log.info(
      `Type debt matches the baseline (${totalDebt} total across ${filesScanned} files scanned).`,
    );
  }
  return 0;
}
