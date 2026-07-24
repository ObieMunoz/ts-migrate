import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import { debtTotal, scanTypeDebt } from '../utils/typeDebt';

export const DEFAULT_BASELINE_FILE = '.ts-migrate-baseline.json';

const BASELINE_VERSION = 1;

const COUNTERS = [
  { key: 'tsExpectError', label: '@ts-expect-error' },
  { key: 'tsIgnore', label: '@ts-ignore' },
  { key: 'anyAlias', label: 'any-alias' },
  { key: 'any', label: 'explicit any' },
] as const;

type CounterKey = (typeof COUNTERS)[number]['key'];
type BaselineCounts = Record<CounterKey, number>;

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
  return {
    tsExpectError: counts.tsExpectError,
    tsIgnore: counts.tsIgnore,
    anyAlias: counts.anyAlias,
    any: counts.any,
  };
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

function writeBaseline(baselinePath: string, files: Record<string, BaselineCounts>): void {
  const baseline: Baseline = { version: BASELINE_VERSION, files: sortedFiles(files) };
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function readBaseline(baselinePath: string): Baseline {
  let parsed: Baseline;
  try {
    parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `Could not read baseline ${baselinePath}: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (parsed?.version !== BASELINE_VERSION || typeof parsed.files !== 'object') {
    throw new Error(
      `Unsupported baseline format in ${baselinePath}. Re-create it with --update-baseline.`,
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
    log.error(err instanceof Error ? err.message : err);
    return -1;
  }

  if (updateBaseline) {
    writeBaseline(baselinePath, current);
    log.info(`Baseline updated: ${displayPath}. Commit it.`);
    return 0;
  }

  if (!fs.existsSync(baselinePath)) {
    writeBaseline(baselinePath, current);
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
    log.error(err instanceof Error ? err.message : err);
    return -1;
  }

  const regressions: string[] = [];
  Object.entries(current).forEach(([file, counts]) => {
    const base = baseline.files[file];
    COUNTERS.forEach(({ key, label }) => {
      const allowed = base?.[key] ?? 0;
      if (counts[key] > allowed) {
        regressions.push(`  ${file}: ${label} ${allowed} -> ${counts[key]}`);
      }
    });
  });

  if (regressions.length > 0) {
    log.error(
      [
        `Type debt increased over the baseline (${displayPath}):`,
        ...regressions,
        `Remove the new suppressions or any-type annotations, or accept them with ` +
          `\`ts-migrate check ${folder} --update-baseline\`.`,
      ].join('\n'),
    );
    return 1;
  }

  const normalizedBaseline = JSON.stringify(sortedFiles(baseline.files));
  const normalizedCurrent = JSON.stringify(sortedFiles(current));
  if (normalizedBaseline !== normalizedCurrent) {
    writeBaseline(baselinePath, current);
    log.info(`Type debt improved; baseline lowered. Commit the updated ${displayPath}.`);
  } else {
    log.info(
      `Type debt matches the baseline (${totalDebt} total across ${filesScanned} files scanned).`,
    );
  }
  return 0;
}
