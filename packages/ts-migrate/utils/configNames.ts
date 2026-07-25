import path from 'path';
import { JS_EXTENSIONS } from './jsExtensions';

/**
 * The extensions a tool config is written in: the JavaScript set plus each
 * one's TypeScript spelling, which swaps the j for a t. A tool that takes its
 * config path as an argument loads either through its own loader, so both
 * count as evidence of what the project builds with. Which of them a
 * migration may rename is a separate question, asked with JS_EXTENSIONS.
 */
export const CONFIG_EXTENSIONS = JS_EXTENSIONS.flatMap((extension) => [
  extension,
  extension.replace('j', 't'),
]);

const CONFIG_EXTENSION_REGEX = new RegExp(`\\.(?:${CONFIG_EXTENSIONS.join('|')})$`);

/**
 * A `conf`/`config` segment after the tool name, suffix open: projects split a
 * config per environment and keep the halves beside the main one, so
 * `webpack.config.production` and `jest.config.integration` name a config the
 * same way `webpack.config` does, and so does `webpack.dev.config`. The
 * segment has to follow a dot, which leaves an application file plainly named
 * `config.js` alone.
 */
const CONFIG_SEGMENT_REGEX = /\.conf(ig)?(\.|$)/;

/** Whether a lowercased, extension-stripped file name names a tool config. */
export function isConfigName(name: string): boolean {
  return CONFIG_SEGMENT_REGEX.test(name);
}

/** Whether a file is `tool`'s config, whatever its language and suffix. */
export function isToolConfigFile(file: string, tool: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (!CONFIG_EXTENSION_REGEX.test(base)) return false;
  const name = base.replace(CONFIG_EXTENSION_REGEX, '');
  return isConfigName(name) && name.split('.')[0] === tool;
}
