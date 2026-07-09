import fs from 'fs';
import path from 'path';
import { mockPluginParams } from '../test-utils';

// Run the plugin inside a fixture directory so it discovers that fixture's
// config. The plugin caches ESLint at module scope, so reset modules each run.
// Mask eslint.config.* files outside the fixture dir so the package-level
// flat config doesn't leak into the plugin's engine detection.
async function runInDir(dir: string, text: string): Promise<string | undefined> {
  const originalCwd = process.cwd();
  const realExistsSync = fs.existsSync;
  process.chdir(dir);
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
