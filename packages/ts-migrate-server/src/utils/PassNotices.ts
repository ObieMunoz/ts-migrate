import path from 'path';
import log from 'updatable-log';
import { PluginFileNotice } from '../../types';

/** One cause, with the files it happened to. */
export interface FileNoticeGroup {
  reason: string;
  ruleId?: string;
  hint?: string;
  /** True when every file with this cause was still processed normally. */
  recovered: boolean;
  /** True when at least one file with this cause had its site marked in place. */
  marked: boolean;
  fileCount: number;
  /** The files, rootDir-relative and sorted. */
  files: string[];
}

// Enough to recognize the shape of the problem; the summary file has them all.
const NAMED_FILES = 3;
// A plugin that reports a distinct cause per file would otherwise print a wall.
const REPORTED_GROUPS = 10;

function groupKey({ reason, ruleId }: PluginFileNotice): string {
  return `${reason}\u0000${ruleId ?? ''}`;
}

function noticeKey(group: FileNoticeGroup, file: string): string {
  return `${groupKey(group)}\u0000${file}`;
}

/**
 * Collects what went wrong during one plugin pass and reports it once the pass
 * is over. Two reasons not to print from inside the pass: a cause that belongs
 * to the project's config fails identically for every file that reaches it, and
 * the progress counter erases the region it last rendered, taking whatever was
 * written there in between with it.
 */
export default class PassNotices {
  private readonly rootDir: string;

  private readonly groupsByKey = new Map<string, FileNoticeGroup>();

  private readonly failedFiles = new Set<string>();

  private readonly alreadyReported: Set<string>;

  /**
   * @param alreadyReported What the same plugin has printed in its earlier
   * passes, which `report` adds to. Share one set across the passes of a
   * repeated plugin group and each cause is printed for a file once, instead
   * of every pass reprinting what the pass before it already said.
   */
  constructor(rootDir: string, alreadyReported: Set<string> = new Set()) {
    this.rootDir = rootDir;
    this.alreadyReported = alreadyReported;
  }

  add(fileName: string, notice: PluginFileNotice): void {
    const relFile = path.relative(this.rootDir, fileName).split(path.sep).join('/');
    const key = groupKey(notice);
    let group = this.groupsByKey.get(key);
    if (!group) {
      group = {
        reason: notice.reason,
        ruleId: notice.ruleId,
        hint: notice.hint,
        recovered: true,
        marked: false,
        fileCount: 0,
        files: [],
      };
      this.groupsByKey.set(key, group);
    }
    group.recovered = group.recovered && notice.recovered === true;
    group.marked = group.marked || notice.marked === true;
    group.hint = group.hint ?? notice.hint;
    group.fileCount += 1;
    group.files.push(relFile);
    if (!notice.recovered) this.failedFiles.add(relFile);
  }

  /** The groups, largest first, with their file lists sorted. */
  groups(): FileNoticeGroup[] {
    return [...this.groupsByKey.values()]
      .map((group) => ({ ...group, files: [...group.files].sort() }))
      .sort((a, b) => b.fileCount - a.fileCount);
  }

  /**
   * Prints the report. Call after the pass's progress counter is finished.
   *
   * Only what the pass could not process. A recovered cause is follow-up work
   * for a person, and a plugin that finds a hundred of them mid-run buries the
   * failures next to it; the run reports those once at the end instead, where
   * they are still on screen when it finishes.
   *
   * Only what it has not said before, too: a repeated group hands the plugin
   * the same files every pass, and a cause it has already printed for a file
   * is the same line again rather than news.
   */
  report(prefix: string): void {
    const groups = this.groups()
      .filter((group) => !group.recovered)
      .map((group) => {
        const files = group.files.filter(
          (file) => !this.alreadyReported.has(noticeKey(group, file)),
        );
        return { ...group, files, fileCount: files.length };
      })
      .filter(({ fileCount }) => fileCount > 0);
    if (groups.length === 0) return;

    const failed = new Set<string>();
    groups.forEach((group) =>
      group.files.filter((file) => this.failedFiles.has(file)).forEach((file) => failed.add(file)),
    );
    log.warn(`${prefix} ${failed.size} file(s) could not be processed and were left unchanged:`);
    groups.slice(0, REPORTED_GROUPS).forEach((group) => {
      const rule = group.ruleId ? ` (rule ${group.ruleId})` : '';
      const named = group.files.slice(0, NAMED_FILES).join(', ');
      const more =
        group.fileCount > NAMED_FILES ? `, and ${group.fileCount - NAMED_FILES} more` : '';
      log.warn(
        `${prefix}   ${group.fileCount} file(s): ${group.reason}${rule}. First: ${named}${more}.`,
      );
      if (group.hint) {
        log.warn(`${prefix}     ${group.hint}`);
      }
    });
    if (groups.length > REPORTED_GROUPS) {
      log.warn(`${prefix} and ${groups.length - REPORTED_GROUPS} more distinct cause(s).`);
    }

    // The capped groups too: they were counted in the line above, and a later
    // pass reprinting them would say the same thing again.
    groups.forEach((group) =>
      group.files.forEach((file) => this.alreadyReported.add(noticeKey(group, file))),
    );
  }
}
