import fs from 'fs';
import path from 'path';
import json5 from 'json5';

/**
 * The flags a run takes, in a file instead of on the command line. A full
 * migration is configured by twenty-odd of them, which is more than fits on a
 * line worth retyping, and the settings that matter are the ones a project
 * keeps rather than picks per run.
 *
 * The file holds flag names as keys. Keys at the top level apply to every
 * command that takes them, and a key named after a command is a section of
 * flags for that command alone, applied over the shared ones:
 *
 *   {
 *     "sources": "app/**\/*",
 *     "inferTypes": false,
 *     "migrate": { "plugin": "jsdoc" }
 *   }
 *
 * No flag is named after a command, so which of the two a key is never has to
 * be guessed from its value.
 */
export const CONFIG_FILE_NAME = 'ts-migrate.config.json';

export const CONFIG_FLAG_DESCRIPTION =
  `Path to a config file supplying flags. Defaults to the first ${CONFIG_FILE_NAME} ` +
  'found from <folder> upward. A flag on the command line overrides the file.';

/**
 * Names yargs owns, and the positional. A config file that sets one of these
 * is answered with what it can set instead of being quietly obeyed: `folder`
 * would be overridden by the positional that is always present anyway, and a
 * config file naming a second config file has no defined precedence.
 */
const RESERVED_KEYS = new Set(['_', '$0', 'config', 'folder', 'help', 'h', 'version', 'v']);

/**
 * The camelCase spelling of a flag name, which is the one the commands declare
 * and so the one their flag sets are keyed by. The CLI accepts both spellings
 * of every flag, so the file does too, and what it hands back to yargs is
 * spelled the way the flag was declared.
 */
function camelCase(key: string): string {
  return key.replace(/-+(.)/g, (_match, char: string) => char.toUpperCase());
}

/**
 * The config file governing a migration, searched for from the folder being
 * migrated upward, the way the project's own TypeScript and ESLint are found.
 * Undefined when there is none, which is the common case and not an error.
 */
export function findConfigFile(rootDir: string): string | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

export interface ReadConfigFileParams {
  configPath: string;
  /** The command being run, which picks its section and its set of flags. */
  command: string;
  /** The flag names every command declares, keyed by command name. */
  flagsByCommand: Record<string, ReadonlySet<string>>;
}

function readObject(configPath: string): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read the config file ${configPath}.`);
  }
  let parsed: unknown;
  try {
    // JSON5 rather than JSON.parse, so the file may carry the comments that
    // say why a flag is set, and so a trailing comma is not an error.
    parsed = json5.parse(text);
  } catch (err) {
    throw new Error(
      `${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath} must hold a JSON object of flags.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The flags a config file supplies to one command: its shared keys, with the
 * command's own section over the top.
 *
 * A key no command anywhere declares is a typo, and fails the run. A key some
 * other command declares is left out rather than refused, which is what lets
 * one file serve a `full` run and a `rename` run that takes a fraction of the
 * same flags. Inside a section there is no such doubt, so a key that command
 * does not take fails there.
 */
export function readConfigFile({
  configPath,
  command,
  flagsByCommand,
}: ReadConfigFileParams): Record<string, unknown> {
  const parsed = readObject(configPath);
  const flags = flagsByCommand[command] ?? new Set<string>();
  const everyFlag = new Set(Object.values(flagsByCommand).flatMap((keys) => [...keys]));

  /** The declared spelling of a key, whichever half of the file it came from. */
  const normalizeKey = (rawKey: string): string => {
    const key = camelCase(rawKey);
    if (RESERVED_KEYS.has(key)) {
      throw new Error(`${configPath}: "${rawKey}" cannot be set from a config file.`);
    }
    return key;
  };

  const shared: Record<string, unknown> = {};
  const sections: Record<string, unknown> = {};
  Object.entries(parsed).forEach(([rawKey, value]) => {
    if (rawKey in flagsByCommand) {
      sections[rawKey] = value;
      return;
    }
    const key = normalizeKey(rawKey);
    if (!everyFlag.has(key)) {
      throw new Error(`${configPath}: "${rawKey}" is not a ts-migrate flag or command.`);
    }
    if (flags.has(key)) shared[key] = value;
  });

  const section = sections[command];
  if (section === undefined) return shared;
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    throw new Error(`${configPath}: the "${command}" section must hold a JSON object of flags.`);
  }

  const result = { ...shared };
  Object.entries(section as Record<string, unknown>).forEach(([rawKey, value]) => {
    const key = normalizeKey(rawKey);
    if (!flags.has(key)) {
      throw new Error(
        `${configPath}: "${rawKey}" in the "${command}" section is not a flag of ` +
          `\`ts-migrate ${command}\`.`,
      );
    }
    result[key] = value;
  });
  return result;
}
