import path from 'path';
import { mockPluginParams } from '../test-utils';

// Run the plugin inside a fixture directory so it discovers that fixture's
// config. The plugin caches ESLint at module scope, so reset modules each run.
async function runInDir(dir: string, text: string): Promise<string | undefined> {
  const originalCwd = process.cwd();
  process.chdir(dir);
  jest.resetModules();
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const plugin = require('../../src/plugins/eslint-fix').default;
    return await plugin.run(mockPluginParams({ text, fileName: 'Foo.tsx' }));
  } finally {
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
