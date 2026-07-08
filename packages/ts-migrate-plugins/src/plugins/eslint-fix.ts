import fs from 'fs';
import path from 'path';
import { loadESLint } from 'eslint';
import { Plugin } from 'ts-migrate-server';

// Either the flat-config or legacy engine; both expose the `lintText` API.
type AnyESLint = InstanceType<Awaited<ReturnType<typeof loadESLint>>>;

// Flat config file names, in ESLint's resolution order.
const FLAT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

// Whether a flat config (`eslint.config.*`) is discoverable from `cwd` upward.
// ESLint 9 always defaults to flat config, so we detect it to fall back to the
// legacy `.eslintrc` engine when absent.
function hasFlatConfig(cwd: string): boolean {
  let dir = cwd;
  while (true) {
    if (FLAT_CONFIG_FILENAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

// Lazily create one ESLint instance, shared across all files in a run.
// (`jiti`, a dependency, is what lets ESLint load a TypeScript `eslint.config.ts`.)
let eslintPromise: Promise<AnyESLint> | undefined;

function getESLint(): Promise<AnyESLint> {
  if (!eslintPromise) {
    eslintPromise = (async () => {
      // Respect an explicit ESLINT_USE_FLAT_CONFIG override if set; otherwise
      // pick flat vs. legacy based on whether a flat config file exists.
      const useFlatConfig =
        process.env.ESLINT_USE_FLAT_CONFIG != null
          ? process.env.ESLINT_USE_FLAT_CONFIG !== 'false'
          : hasFlatConfig(process.cwd());
      const ESLintClass = await loadESLint({ useFlatConfig });
      return new ESLintClass({
        fix: true,
        // Set ignore to false so we can lint in `tmp` for testing.
        ignore: false,
      });
    })();
  }
  return eslintPromise;
}

const eslintFixPlugin: Plugin = {
  name: 'eslint-fix',
  async run({ fileName, text }) {
    try {
      const cli = await getESLint();
      let newText = text;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const [report] = await cli.lintText(newText, {
          filePath: fileName,
        });

        if (!report || !report.output || report.output === newText) {
          break;
        }
        newText = report.output;
      }
      return newText;
    } catch (e) {
      if (e instanceof Error) {
        // eslint-disable-next-line no-console
        console.error('Error occurred in eslint-fix plugin: ', e.message);
      }
      return text;
    }
  },
};

export default eslintFixPlugin;
