import fs from 'fs';
import path from 'path';
import { mockPluginParams } from '../test-utils';

// Run the plugin inside a fixture directory so it discovers that fixture's
// config. The plugin caches ESLint at module scope, so reset modules each run.
// The plugin picks its engine from ESLINT_USE_FLAT_CONFIG and from any
// eslint.config.* found between cwd and the filesystem root, so clear the env
// var and mask eslint.config.* files outside the fixture dir to keep the
// tests hermetic.
async function runInDir(dir: string, text: string): Promise<string | undefined> {
  const originalCwd = process.cwd();
  const originalFlatConfigEnv = process.env.ESLINT_USE_FLAT_CONFIG;
  const realExistsSync = fs.existsSync;
  process.chdir(dir);
  delete process.env.ESLINT_USE_FLAT_CONFIG;
  jest.resetModules();
  const existsSync = jest.spyOn(fs, 'existsSync').mockImplementation((file) => {
    if (/eslint\.config\.[cm]?[jt]s$/.test(String(file)) && path.dirname(String(file)) !== dir) {
      return false;
    }
    return realExistsSync(file);
  });
  try {
    const plugin = require('../../src/plugins/eslint-fix').default;
    return await plugin.run(mockPluginParams({ text, fileName: 'Foo.tsx' }));
  } finally {
    existsSync.mockRestore();
    if (originalFlatConfigEnv !== undefined) {
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
