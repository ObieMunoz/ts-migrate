import fs from 'fs';
import path from 'path';
import { isToolConfigFile } from './configNames';
import { DependencyManifest } from './dependencyManifest';
import { directoriesToRepoRoot } from './repoRoot';

export type BundlerName = 'vite' | 'webpack';

export interface BundlerDetection {
  name: BundlerName;
  /** Human-readable evidence, with rootDir-relative paths. */
  evidence: string;
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

const DEPENDENCY_FIELDS: Array<keyof DependencyManifest> = ['devDependencies', 'dependencies'];

function dependencyEvidence(
  packageJson: DependencyManifest | null,
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
 * The bundler a project builds with, from its declared dependencies or a
 * config file at rootDir. Both outcomes of the package.json `type` heuristic
 * are wrong for one: bundlers resolve extensionless relative imports and
 * define import.meta, neither of which commonjs or nodenext allows.
 */
export function detectBundler(
  rootDir: string,
  packageJson: DependencyManifest | null,
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
    const file = entries.find((entry) => isToolConfigFile(entry, name));
    return file !== undefined ? { name, evidence: file } : null;
  }).filter((detection): detection is BundlerDetection => detection !== null);
  return detections[0] ?? null;
}

/**
 * Whether `types: ["vite/client"]` resolves. An install above the repository
 * boundary exists only on this machine, and a pinned entry that fails to
 * resolve is a hard TS2688 everywhere else.
 */
export function hasViteClientTypes(rootDir: string): boolean {
  return directoriesToRepoRoot(rootDir).some((dir) =>
    fs.existsSync(path.join(dir, 'node_modules', 'vite', 'client.d.ts')),
  );
}
