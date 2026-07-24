import log from 'updatable-log';

// Refresh the in-place counter at most this often on a TTY.
const TTY_UPDATE_INTERVAL_MS = 250;
// Without a TTY, log-update cannot erase lines, so the counter falls back to
// plain lines; keep them rare enough for a CI log.
const PLAIN_LOG_INTERVAL_MS = 10_000;

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

  private processed = 0;

  private lastRender: number;

  constructor({
    prefix,
    total,
    showCurrentFile,
    isTTY = process.stdout.isTTY === true,
    now = Date.now,
  }: PassProgressParams) {
    this.prefix = prefix;
    this.total = total;
    this.showCurrentFile = showCurrentFile;
    this.isTTY = isTTY;
    this.now = now;
    // An in-place counter can appear right away; plain lines wait out a full
    // interval so a short pass logs nothing extra.
    this.lastRender = isTTY ? -Infinity : this.now();
  }

  fileStarted(relFile: string): void {
    if (!this.showCurrentFile) return;
    this.render(`${this.processed + 1}/${this.total} ${relFile}`);
  }

  fileFinished(): void {
    this.processed += 1;
    if (this.showCurrentFile) return;
    this.render(`${this.processed}/${this.total} files processed`);
  }

  finish(): void {
    log.clear();
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
