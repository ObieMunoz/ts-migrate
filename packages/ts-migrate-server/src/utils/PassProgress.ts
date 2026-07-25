import log from 'updatable-log';
import prettyMilliseconds from 'pretty-ms';

// Refresh the in-place counter at most this often on a TTY.
const TTY_UPDATE_INTERVAL_MS = 250;
// Without a TTY, log-update cannot erase lines, so the counter falls back to
// plain lines; keep them rare enough for a CI log.
const PLAIN_LOG_INTERVAL_MS = 10_000;
// A file slower than this gets a permanent line of its own when it finishes,
// so the completed log names what the pass spent its time on.
const SLOW_FILE_MS = 30_000;
// Assumed terminal width when stdout reports none.
const DEFAULT_COLUMNS = 80;
// log-update hard-wraps, so a counter wider than the terminal redraws as a
// multi-line block. Covers the arrow and space updatable-log prepends plus the
// last column, which stays free.
const COUNTER_LINE_OVERHEAD = 4;
const ELLIPSIS = '...';

interface PassProgressParams {
  /** Prepended to every counter line, e.g. `[plugin-name]`. */
  prefix: string;
  total: number;
  /**
   * Name the file currently being processed. Only meaningful when files run
   * one at a time; a concurrent pass shows a bare completion counter instead,
   * since its files all start together and finish in arbitrary order.
   */
  showCurrentFile: boolean;
  isTTY?: boolean;
  now?: () => number;
  /** Read per render, so a resize mid-pass takes effect. */
  columns?: () => number;
}

/**
 * A throttled processed/total counter for one plugin pass, so a long pass
 * shows liveness without per-file log lines. Quiet mode needs no handling
 * here: updatable-log drops update() and info() itself when log.quiet is set.
 */
export default class PassProgress {
  private readonly prefix: string;

  private readonly total: number;

  private readonly showCurrentFile: boolean;

  private readonly isTTY: boolean;

  private readonly now: () => number;

  private readonly columns: () => number;

  private processed = 0;

  private lastRender: number;

  private currentFile: string | null = null;

  private currentFileStarted = 0;

  constructor({
    prefix,
    total,
    showCurrentFile,
    isTTY = process.stdout.isTTY === true,
    now = Date.now,
    columns = () => process.stdout.columns || DEFAULT_COLUMNS,
  }: PassProgressParams) {
    this.prefix = prefix;
    this.total = total;
    this.showCurrentFile = showCurrentFile;
    this.isTTY = isTTY;
    this.now = now;
    this.columns = columns;
    // An in-place counter can appear right away; plain lines wait out a full
    // interval so a short pass logs nothing extra.
    this.lastRender = isTTY ? -Infinity : this.now();
  }

  fileStarted(relFile: string): void {
    if (!this.showCurrentFile) return;
    this.currentFile = relFile;
    this.currentFileStarted = this.now();
    const counter = `${this.processed + 1}/${this.total}`;
    // Plain lines scroll rather than redraw, and the whole path is the more
    // useful record there.
    const file = this.isTTY
      ? truncateStart(
          relFile,
          this.columns() - COUNTER_LINE_OVERHEAD - `${this.prefix} ${counter} `.length,
        )
      : relFile;
    this.render(`${counter} ${file}`);
  }

  fileFinished(): void {
    this.processed += 1;
    if (!this.showCurrentFile) {
      this.render(`${this.processed}/${this.total} files processed`);
      return;
    }
    this.reportSlowFile();
  }

  finish(): void {
    log.clear();
  }

  /**
   * Names a file that took an outsized share of the pass. Emitted on finish
   * rather than on a timer: a plugin's run() may hold the event loop for the
   * whole file, so nothing on the main thread can fire while one is wedged.
   */
  private reportSlowFile(): void {
    const relFile = this.currentFile;
    this.currentFile = null;
    if (relFile === null) return;
    const elapsed = this.now() - this.currentFileStarted;
    if (elapsed < SLOW_FILE_MS) return;
    log.info(`${this.prefix} ${relFile} took ${prettyMilliseconds(elapsed)}.`);
  }

  private render(message: string): void {
    const interval = this.isTTY ? TTY_UPDATE_INTERVAL_MS : PLAIN_LOG_INTERVAL_MS;
    const now = this.now();
    if (now - this.lastRender < interval) return;
    this.lastRender = now;
    if (this.isTTY) {
      log.update(`${this.prefix} ${message}`);
    } else {
      log.info(`${this.prefix} ${message}`);
    }
  }
}

/** Keeps the tail of a path, which is the part that identifies the file. */
function truncateStart(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= ELLIPSIS.length) return value.slice(Math.max(value.length - max, 0));
  return `${ELLIPSIS}${value.slice(value.length - (max - ELLIPSIS.length))}`;
}
