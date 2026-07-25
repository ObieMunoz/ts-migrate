import { MigrateResult } from '@obiemunoz/ts-migrate-server';
import { FOLLOW_UP_MARKER } from '@obiemunoz/ts-migrate-plugins';

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * What the run recognized but left for a person, at the end of the run.
 *
 * Counts and causes only. Every file name is already in the file it belongs to,
 * and a run over a real project produces enough of them that printing the list
 * here would bury the shape of the problem the same way reporting each cause
 * mid-pass did.
 */
export default function formatFollowUpReport(
  notices: MigrateResult['pluginNotices'],
): string | null {
  if (notices.length === 0) return null;

  const byPlugin = new Map<string, MigrateResult['pluginNotices']>();
  notices.forEach((notice) => {
    const causes = byPlugin.get(notice.pluginName);
    if (causes) causes.push(notice);
    else byPlugin.set(notice.pluginName, [notice]);
  });

  const fileCount = (causes: MigrateResult['pluginNotices']) =>
    new Set(causes.flatMap((cause) => cause.files)).size;

  const lines = [
    `Follow-up notices: ${pluralize(fileCount(notices), 'file')} across ` +
      `${pluralize(byPlugin.size, 'plugin')}.`,
    '',
  ];

  [...byPlugin]
    .map(([pluginName, causes]) => ({ pluginName, causes, files: fileCount(causes) }))
    .sort((a, b) => b.files - a.files || (a.pluginName < b.pluginName ? -1 : 1))
    .forEach(({ pluginName, causes, files }) => {
      lines.push(
        `  ${pluginName}  ${pluralize(files, 'file')}, ${pluralize(causes.length, 'cause')}`,
      );
      // One line per distinct remedy rather than per cause: a plugin that
      // declines for seven reasons usually wants the same thing done about it.
      [...new Set(causes.map((cause) => cause.hint).filter(Boolean))].forEach((hint) =>
        lines.push(`    ${hint}`),
      );
      lines.push('');
    });

  if (notices.some((notice) => notice.marked)) {
    lines.push(`  Each site is marked in place: grep -rn "${FOLLOW_UP_MARKER}"`);
  }

  return lines.join('\n').trimEnd();
}
