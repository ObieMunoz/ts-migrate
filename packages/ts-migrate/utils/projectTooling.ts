/**
 * What a project already has of the plumbing a migration leaves to its caller:
 * a way to build or run TypeScript, and an ESLint that reads it. Both answer
 * from what the project declares, which is as far as static evidence goes —
 * whether a build really emits, or whether ESLint really parses a `.ts` file, is
 * only answered by running them. Both err towards answering no, because a
 * redundant instruction costs a line and a missing one costs a broken build
 * nobody was told about.
 */
import fs from 'fs';
import path from 'path';
import { readText } from './readText';

/**
 * Commands that compile or run TypeScript with no further configuration.
 * Webpack and Rollup are absent on purpose: they read `.ts` only through one of
 * the loaders and plugins below, so the loader is the evidence, not the bundler.
 */
const TYPESCRIPT_COMMANDS = new Set([
  // Compilers.
  'tsc',
  'tsgo',
  'tsup',
  'tsdown',
  'unbuild',
  'esbuild',
  'swc',
  // Runners.
  'ts-node',
  'ts-node-dev',
  'tsx',
  'tsimp',
  'swc-node',
  '@swc-node',
  'vite-node',
  'bun',
  'deno',
  // Bundlers and framework CLIs that read `.ts` themselves.
  'vite',
  'next',
  'nuxt',
  'astro',
  'parcel',
  'rspack',
  'rsbuild',
  'react-scripts',
  'expo',
  'nest',
  'remix',
]);

/**
 * Packages that give a project a way to compile or run TypeScript: the tools
 * above as their package names, plus what teaches a JavaScript toolchain to
 * read `.ts`. `typescript` itself is absent — it type-checks, and this run may
 * well be what put it there.
 */
const TYPESCRIPT_BUILD_DEPENDENCIES = new Set([
  'ts-node',
  'ts-node-dev',
  'tsx',
  'tsimp',
  'tsup',
  'tsdown',
  'unbuild',
  'esbuild',
  '@swc/core',
  '@swc/cli',
  '@swc-node/register',
  'swc-node',
  'vite',
  'next',
  'nuxt',
  'astro',
  'parcel',
  '@parcel/core',
  '@rspack/core',
  '@rsbuild/core',
  'react-scripts',
  'expo',
  'react-native',
  '@nestjs/cli',
  '@remix-run/dev',
  'ts-loader',
  'swc-loader',
  'esbuild-loader',
  'awesome-typescript-loader',
  '@babel/preset-typescript',
  '@babel/plugin-transform-typescript',
  '@vue/cli-plugin-typescript',
  'babel-preset-react-app',
  'babel-preset-expo',
  '@react-native/babel-preset',
  'metro-react-native-babel-preset',
  '@rollup/plugin-typescript',
  'rollup-plugin-typescript2',
  'rollup-plugin-esbuild',
  'gulp-typescript',
  'grunt-ts',
]);

/**
 * The compilers that emit nothing when asked not to. `tsc --noEmit` is the
 * type-check the migration's own last step runs; a project whose only tsc
 * invocation is that one still has nothing that produces JavaScript.
 */
const TYPE_CHECK_ONLY_COMMANDS = new Set(['tsc', 'tsgo']);

const NO_EMIT_FLAG = /^--?noemit$/i;

/** Node runs TypeScript itself with one of these, without a runner package. */
const NODE_TYPESCRIPT_FLAGS = new Set([
  '--experimental-strip-types',
  '--experimental-transform-types',
]);

const ESLINT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.mjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc',
];

/**
 * What a setup that lints TypeScript names, matched against both the config
 * text and the declared dependencies. `@typescript-eslint/parser`,
 * `plugin:@typescript-eslint/recommended` and `import tseslint from
 * 'typescript-eslint'` all contain the first marker; the others are shared
 * configs that bring the parser and plugin along.
 */
const TYPESCRIPT_LINT_MARKERS = [
  'typescript-eslint',
  'airbnb-typescript',
  'standard-with-typescript',
];

/** Shared configs that lint TypeScript under a name that says nothing about it. */
const TYPESCRIPT_LINT_DEPENDENCIES = new Set([
  'eslint-config-love',
  'eslint-config-react-app',
  '@react-native/eslint-config',
  '@nuxt/eslint-config',
]);

export type EslintTypeScriptSupport =
  /** No ESLint above the folder at all, so there is nothing to teach. */
  | 'no-eslint'
  /** ESLint, with no sign of the TypeScript parser and plugin. */
  | 'javascript-only'
  | 'typescript';

interface ProjectManifests {
  /** Every `scripts` value, from every manifest. */
  scripts: string[];
  /** Every `dependencies` and `devDependencies` name, from every manifest. */
  dependencies: Set<string>;
  /** Every `eslintConfig` block, as text for the marker scan. */
  eslintConfigs: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * `rootDir` and its ancestors up to the repository root: a monorepo declares
 * the shared toolchain and the orchestrating scripts in either place, and an
 * ESLint config above a folder governs that folder. Above the checkout is this
 * machine, which is the boundary hasViteClientTypes stops at too.
 */
function directoriesToRepoRoot(rootDir: string): string[] {
  const dirs: string[] = [];
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return dirs;
  }
}

function readManifests(rootDir: string): ProjectManifests {
  const merged: ProjectManifests = { scripts: [], dependencies: new Set(), eslintConfigs: [] };
  directoriesToRepoRoot(rootDir).forEach((dir) => {
    const text = readText(path.join(dir, 'package.json'));
    if (text === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const manifest = record(parsed);
    Object.values(record(manifest.scripts)).forEach((script) => {
      if (typeof script === 'string') merged.scripts.push(script);
    });
    (['dependencies', 'devDependencies'] as const).forEach((field) => {
      Object.keys(record(manifest[field])).forEach((name) => merged.dependencies.add(name));
    });
    if (manifest.eslintConfig !== undefined) {
      merged.eslintConfigs.push(JSON.stringify(manifest.eslintConfig));
    }
  });
  return merged;
}

/** The name a script token invokes, and the package a loader specifier names. */
function invokedNames(token: string): string[] {
  const bare = token.replace(/^['"]+/, '').replace(/['"]+$/, '');
  if (bare === '') return [];
  const segments = bare.split('/');
  // The basename covers `node_modules/.bin/tsc`; the head covers the loader
  // specifiers a runner is used through, as in `node -r ts-node/register`.
  return [segments[segments.length - 1], segments[0]];
}

/** Whether one command in a script compiles or runs TypeScript. */
function commandBuildsTypeScript(command: string): boolean {
  // Per command rather than per script: a `&&` chain that type-checks and then
  // builds holds the answer in one of its halves, and the flags of one half say
  // nothing about the other.
  return command.split(/[\n;&|]+/).some((segment) => {
    const tokens = segment.split(/\s+/).filter((token) => token !== '');
    if (tokens.some((token) => NODE_TYPESCRIPT_FLAGS.has(token))) return true;
    const invoked = tokens
      .flatMap(invokedNames)
      .filter((name) => TYPESCRIPT_COMMANDS.has(name));
    if (invoked.length === 0) return false;
    if (
      invoked.every((name) => TYPE_CHECK_ONLY_COMMANDS.has(name)) &&
      tokens.some((token) => NO_EMIT_FLAG.test(token))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Whether the project has a way to produce or run JavaScript from TypeScript
 * sources: a script that invokes a compiler or a TS-aware runner, or a declared
 * dependency that is one.
 */
export function hasTypeScriptBuild(rootDir: string): boolean {
  const { scripts, dependencies } = readManifests(rootDir);
  if (scripts.some(commandBuildsTypeScript)) return true;
  return [...dependencies].some((name) => TYPESCRIPT_BUILD_DEPENDENCIES.has(name));
}

/** The ESLint configs in force for the folder, as text. ESLint walks up too. */
function readEslintConfigs(rootDir: string): string[] {
  return directoriesToRepoRoot(rootDir).flatMap((dir) =>
    ESLINT_CONFIG_FILENAMES.map((name) => readText(path.join(dir, name))).filter(
      (text): text is string => text !== undefined,
    ),
  );
}

/**
 * Whether ESLint is set up for TypeScript, and whether the project lints with
 * ESLint at all: a project with no ESLint has nothing to teach it about.
 */
export function eslintTypeScriptSupport(rootDir: string): EslintTypeScriptSupport {
  const { dependencies, eslintConfigs } = readManifests(rootDir);
  const configs = [...eslintConfigs, ...readEslintConfigs(rootDir)];
  const marked = (text: string) => TYPESCRIPT_LINT_MARKERS.some((marker) => text.includes(marker));
  const typeScriptAware =
    [...dependencies].some((name) => marked(name) || TYPESCRIPT_LINT_DEPENDENCIES.has(name)) ||
    configs.some(marked);
  if (typeScriptAware) return 'typescript';
  return dependencies.has('eslint') || configs.length > 0 ? 'javascript-only' : 'no-eslint';
}
