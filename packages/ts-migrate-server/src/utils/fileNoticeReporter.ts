import log from 'updatable-log';
import { PluginFileNotice, PluginParams } from '../../types';

/**
 * How a plugin reports what went wrong for one file: through the runner when
 * there is one, so identical causes are grouped and printed once the pass's
 * progress counter is out of the way, and straight to the log for a caller
 * driving a plugin on its own, where there is no pass to group into.
 */
export default function fileNoticeReporter(
  params: Pick<PluginParams<unknown>, 'fileName' | 'reportFileNotice'>,
  prefix: string,
): (notice: PluginFileNotice) => void {
  if (params.reportFileNotice) return params.reportFileNotice;
  return ({ reason, ruleId, hint }) => {
    const rule = ruleId ? ` (rule ${ruleId})` : '';
    log.warn(`${prefix} ${params.fileName}: ${reason}${rule}.${hint ? ` ${hint}` : ''}`);
  };
}
