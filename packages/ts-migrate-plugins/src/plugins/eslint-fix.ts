import fs from 'fs';
import path from 'path';
import { loadESLint } from 'eslint';
import { Plugin } from '@obiemunoz/ts-migrate-server';

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

// The exact text eslint-fix last produced for each file. eslint's autofix is
// idempotent, so a file whose text is unchanged since then is already at a
// fixed point and re-linting it is a guaranteed no-op. This lets the second
// eslint-fix pass (which runs after ts-ignore) skip every file ts-ignore left
// untouched instead of re-linting the whole project.
const lastFixedText = new Map<string, string>();

// Warned at most once per run: a project whose ESLint parser is not
// TypeScript-aware fails the same way for every file.
let warnedAboutParseErrors = false;

const eslintFixPlugin: Plugin = {
  name: 'eslint-fix',
  async run({ fileName, text }) {
    if (lastFixedText.get(fileName) === text) {
      return text;
    }
    try {
      const cli = await getESLint();
      let newText = text;
      while (true) {
        const [report] = await cli.lintText(newText, {
          filePath: fileName,
        });

        const fatalMessage = report?.messages?.find((message) => message.fatal);
        if (fatalMessage && !warnedAboutParseErrors) {
          warnedAboutParseErrors = true;
          console.warn(
            `[eslint-fix] ESLint could not parse ${fileName} (${fatalMessage.message}). ` +
              'Lint fixes are skipped for files ESLint cannot parse. If this is a TypeScript ' +
              'file, the project ESLint config likely needs the @typescript-eslint parser.',
          );
        }

        if (!report || !report.output || report.output === newText) {
          break;
        }
        newText = report.output;
      }
      lastFixedText.set(fileName, newText);
      return newText;
    } catch (e) {
      console.error('Error occurred in eslint-fix plugin: ', e instanceof Error ? e.message : e);
      return text;
    }
  },
};

export default eslintFixPlugin;
