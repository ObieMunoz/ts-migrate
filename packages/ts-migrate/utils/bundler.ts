import fs from 'fs';
import path from 'path';

export type BundlerName = 'vite' | 'webpack';

export interface BundlerDetection {
  name: BundlerName;
  /** Human-readable evidence, with rootDir-relative paths. */
  evidence: string;
}

export interface BundlerPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Vite first: a project holding both is a Vite project with webpack left
// over, and "vite/client" is the more specific of the two type packages.
const BUNDLERS: BundlerName[] = ['vite', 'webpack'];

// react-scripts builds with webpack and keeps the config to itself, so a
// Create React App project declares the wrapper and never webpack.
const BUNDLER_DEPENDENCIES: Record<BundlerName, string[]> = {
  vite: ['vite'],
  webpack: ['webpack', 'react-scripts'],
};

const CONFIG_EXTENSION_REGEX = /\.[cm]?[jt]sx?$/;

const DEPENDENCY_FIELDS: Array<keyof BundlerPackageJson> = ['devDependencies', 'dependencies'];

function dependencyEvidence(
  packageJson: BundlerPackageJson | null,
  name: BundlerName,
): string | undefined {
  if (!packageJson) return undefined;
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = packageJson[field];
    if (typeof dependencies !== 'object' || dependencies === null) return [];
    return BUNDLER_DEPENDENCIES[name]
      .filter((dependency) => dependency in dependencies)
      .map((dependency) => `"${dependency}" in ${field}`);
  })[0];
}

/**
 * A config file the bundler loads by name, at the project root. The suffix is
 * open (`webpack.config.dev.js`, `vite.config.mts`) because both tools take
 * the config path as an argument and projects split theirs per environment.
 */
function configFile(entries: string[], name: BundlerName): string | undefined {
  return entries.find(
    (entry) => entry.startsWith(`${name}.config.`) && CONFIG_EXTENSION_REGEX.test(entry),
  );
}

/**
 * The bundler a project builds with, from its declared dependencies or a
 * config file at rootDir. Both outcomes of the package.json `type` heuristic
 * are wrong for one: bundlers resolve extensionless relative imports and
 * define import.meta, neither of which commonjs or nodenext allows.
 */
export function detectBundler(
  rootDir: string,
  packageJson: BundlerPackageJson | null,
): BundlerDetection | null {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(rootDir);
  } catch {
    // Unreadable rootDir; the dependency evidence still stands on its own.
  }
  const detections = BUNDLERS.map((name): BundlerDetection | null => {
    const declared = dependencyEvidence(packageJson, name);
    if (declared !== undefined) return { name, evidence: declared };
    const file = configFile(entries, name);
    return file !== undefined ? { name, evidence: file } : null;
  }).filter((detection): detection is BundlerDetection => detection !== null);
  return detections[0] ?? null;
}

/**
 * Whether `types: ["vite/client"]` resolves. Mirrors the repository boundary
 * installedTypesPackages stops at: an install found above it exists only on
 * this machine, and a pinned entry that fails to resolve is a hard TS2688
 * everywhere else.
 */
export function hasViteClientTypes(rootDir: string): boolean {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'vite', 'client.d.ts'))) return true;
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return false;
  }
}
