import fs from 'fs';
import path from 'path';
import { mockPluginParams } from '../test-utils';

const FLAT_CONFIG_RE = /^eslint\.config\.[mc]?[jt]s$/;

// Run the plugin inside a fixture directory so it discovers that fixture's
// config. The plugin caches ESLint at module scope, so reset modules each run.
// Engine selection must depend only on the fixture: clear any ambient
// ESLINT_USE_FLAT_CONFIG, and hide eslint.config.* files outside the fixture
// so a config in a directory above the repo can't flip the detection.
async function runInDir(dir: string, text: string): Promise<string | undefined> {
  const originalCwd = process.cwd();
  const originalFlatConfigEnv = process.env.ESLINT_USE_FLAT_CONFIG;
  delete process.env.ESLINT_USE_FLAT_CONFIG;
  const realExistsSync = fs.existsSync;
  const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation((target) => {
    const resolved = path.resolve(String(target));
    if (FLAT_CONFIG_RE.test(path.basename(resolved)) && !resolved.startsWith(dir + path.sep)) {
      return false;
    }
    return realExistsSync(target);
  });
  process.chdir(dir);
  jest.resetModules();
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const plugin = require('../../src/plugins/eslint-fix').default;
    return await plugin.run(mockPluginParams({ text, fileName: 'Foo.tsx' }));
  } finally {
    existsSyncSpy.mockRestore();
    if (originalFlatConfigEnv === undefined) {
      delete process.env.ESLINT_USE_FLAT_CONFIG;
    } else {
      process.env.ESLINT_USE_FLAT_CONFIG = originalFlatConfigEnv;
    }
    process.chdir(originalCwd);
  }
}

describe('eslint-fix plugin', () => {
  it('applies fixes using a flat config (eslint.config.*)', async () => {
    const result = await runInDir(
      path.join(__dirname, '..', 'fixtures', 'eslint-flat'),
      `const hello = 'world'`,
    );

    expect(result).toBe(`const hello = 'world';\n`);
  });

  it('applies fixes using a legacy .eslintrc config', async () => {
    const result = await runInDir(
      path.join(__dirname, '..', 'fixtures', 'eslint-legacy'),
      `const hello = 'world'`,
    );

    expect(result).toBe(`const hello = 'world';\n`);
  });
});
