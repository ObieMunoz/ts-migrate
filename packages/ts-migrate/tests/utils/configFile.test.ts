import fs from 'fs';
import path from 'path';
import { createTmpDir, deleteDir } from '@obiemunoz/ts-migrate-test-utils';
import { CONFIG_FILE_NAME, findConfigFile, readConfigFile } from '../../utils/configFile';

/**
 * Two commands sharing some flags and each holding one of its own, which is
 * the shape the real commands have and the only thing the merge rules turn on.
 */
const flagsByCommand: Record<string, ReadonlySet<string>> = {
  migrate: new Set(['config', 'folder', 'help', 'sources', 'gitignore', 'inferTypes', 'plugin']),
  rename: new Set(['config', 'folder', 'help', 'sources', 'gitignore', 'dryRun']),
};

let rootDir: string;

beforeEach(() => {
  // Outside the repository: findConfigFile walks up, and under the shared
  // scratch root it would walk into this repository's own tree.
  rootDir = createTmpDir('ts-migrate-config-');
});

afterEach(() => {
  deleteDir(rootDir);
});

function writeConfig(text: string, dir = rootDir): string {
  const configPath = path.join(dir, CONFIG_FILE_NAME);
  fs.writeFileSync(configPath, text);
  return configPath;
}

const read = (configPath: string, command: string) =>
  readConfigFile({ configPath, command, flagsByCommand });

describe('findConfigFile', () => {
  it('finds the file in the folder itself', () => {
    const configPath = writeConfig('{}');

    expect(findConfigFile(rootDir)).toBe(configPath);
  });

  it('walks up to find one above the folder', () => {
    const configPath = writeConfig('{}');
    const nested = path.join(rootDir, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });

    expect(findConfigFile(nested)).toBe(configPath);
  });

  it('takes the nearest one when both a folder and its parent have one', () => {
    writeConfig('{}');
    const nested = path.join(rootDir, 'app');
    fs.mkdirSync(nested);
    const nearest = writeConfig('{}', nested);

    expect(findConfigFile(nested)).toBe(nearest);
  });

  it('is undefined when there is none, which is not an error', () => {
    expect(findConfigFile(rootDir)).toBeUndefined();
  });
});

describe('readConfigFile', () => {
  it('reads flags from the top level', () => {
    const configPath = writeConfig('{ "sources": "app/**/*", "inferTypes": false }');

    expect(read(configPath, 'migrate')).toEqual({ sources: 'app/**/*', inferTypes: false });
  });

  it('accepts either spelling of a flag, and reports the camelCase one', () => {
    const configPath = writeConfig('{ "infer-types": false, "dry-run": true }');

    expect(read(configPath, 'rename')).toEqual({ dryRun: true });
  });

  // The file may say why a flag is set, which is most of the point of keeping
  // one, and a trailing comma is what an edited list leaves behind.
  it('allows comments and a trailing comma', () => {
    const configPath = writeConfig(`{
      // Vendored, and not ours to annotate.
      "sources": "app/**/*",
    }`);

    expect(read(configPath, 'migrate')).toEqual({ sources: 'app/**/*' });
  });

  it('applies a command section over the shared flags', () => {
    const configPath = writeConfig(
      '{ "sources": "app/**/*", "migrate": { "sources": "lib/**/*", "plugin": "jsdoc" } }',
    );

    expect(read(configPath, 'migrate')).toEqual({ sources: 'lib/**/*', plugin: 'jsdoc' });
  });

  it('leaves another command section alone', () => {
    const configPath = writeConfig('{ "migrate": { "plugin": "jsdoc" } }');

    expect(read(configPath, 'rename')).toEqual({});
  });

  // One file serves every command, so a shared key another command takes is
  // not a mistake. Refusing it would make a `full` config break a `rename`.
  it('leaves out a shared flag the running command does not take', () => {
    const configPath = writeConfig('{ "sources": "app/**/*", "inferTypes": false }');

    expect(read(configPath, 'rename')).toEqual({ sources: 'app/**/*' });
  });

  it('rejects a key no command takes', () => {
    const configPath = writeConfig('{ "infrTypes": false }');

    expect(() => read(configPath, 'migrate')).toThrow('"infrTypes" is not a ts-migrate flag');
  });

  // Inside a section there is no other command it could have been meant for.
  it('rejects a key in a section the command does not take', () => {
    const configPath = writeConfig('{ "rename": { "plugin": "jsdoc" } }');

    expect(() => read(configPath, 'rename')).toThrow(
      '"plugin" in the "rename" section is not a flag of `ts-migrate rename`',
    );
  });

  it.each([['folder'], ['config'], ['help']])('rejects the reserved key %s', (key) => {
    const configPath = writeConfig(`{ ${JSON.stringify(key)}: "x" }`);

    expect(() => read(configPath, 'migrate')).toThrow(
      `"${key}" cannot be set from a config file.`,
    );
  });

  it('names the file when it does not parse', () => {
    const configPath = writeConfig('{ "sources": }');

    expect(() => read(configPath, 'migrate')).toThrow(`${configPath} is not valid JSON`);
  });

  it.each([['[]'], ['"sources"'], ['null']])('rejects %s, which is not an object', (text) => {
    const configPath = writeConfig(text);

    expect(() => read(configPath, 'migrate')).toThrow('must hold a JSON object of flags');
  });

  it('rejects a section that is not an object', () => {
    const configPath = writeConfig('{ "migrate": "jsdoc" }');

    expect(() => read(configPath, 'migrate')).toThrow(
      'the "migrate" section must hold a JSON object of flags',
    );
  });

  it('names a file it cannot read', () => {
    const missing = path.join(rootDir, 'nope.json');

    expect(() => read(missing, 'migrate')).toThrow(`Cannot read the config file ${missing}`);
  });
});
