import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import {
  formatTypesPackagePreflight,
  preflightTypesPackages,
} from '@obiemunoz/ts-migrate-plugins';
import { errorMessage } from '@obiemunoz/ts-migrate-server';
import {
  AssetDeclarations,
  buildAssetDeclarations,
  writeAssetDeclarations,
} from '../utils/assetModules';
import { logApplicationEntries, partitionBootstrapFiles } from '../utils/bootstrapFiles';
import { detectBundler, hasViteClientTypes } from '../utils/bundler';
import { listGitignoredDirectories, partitionGitignored } from '../utils/gitignore';
import { JS_EXTENSION_REGEX } from '../utils/jsExtensions';
import { detectPathAliases, logPathAliases, renderPathAliases } from '../utils/pathAliases';
import isIncludedByTsConfig from '../utils/tsConfigIncludes';

interface InitParams {
  rootDir: string;
  isExtendedConfig: boolean;
}

interface PackageJson {
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const extendedConfig = `{
  "extends": "../typescript/tsconfig.base.json",
  "include": [".", "../typescript/types"]
}
`;

// TypeScript 6 no longer loads node_modules/@types automatically when
// "types" is unspecified (bulk inclusion requires types: ["*"], which
// TypeScript 5 rejects). Pinning the packages present at init time makes
// every compiler version type-check the migrated project the same way.
function installedTypesPackages(rootDir: string): string[] {
  const names = new Set<string>();
  // Mirror the compiler's default typeRoots (node_modules/@types in the
  // project directory and its ancestors), but stop at the repository
  // boundary: an entry found above it exists only on this machine, and a
  // pinned entry that fails to resolve is a hard TS2688 everywhere else.
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    const typesDir = path.join(dir, 'node_modules', '@types');
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(typesDir);
    } catch {
      // No @types directory at this level.
    }
    entries.forEach((entry) => {
      if (entry.startsWith('.')) return;
      try {
        if (!fs.statSync(path.join(typesDir, entry)).isDirectory()) return;
      } catch {
        // Dangling symlink; the compiler's own enumeration skips these too.
        return;
      }
      try {
        // "typings": null marks a stub whose library ships its own types;
        // the compiler skips these during automatic inclusion.
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(typesDir, entry, 'package.json'), 'utf-8'),
        );
        if (packageJson.typings === null) return;
      } catch {
        // Unreadable package.json; assume a regular @types package.
      }
      names.add(entry);
    });
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) break;
  }
  return [...names].sort();
}

// No tsconfig exists yet, so the bootstrap detection candidates come from a
// walk of rootDir mirroring the selection rename will make: dot-prefixed
// names are invisible to the tsconfig include matcher and stay out.
function findJsFiles(rootDir: string, skippedDirectories: string[]): string[] {
  const skippedNames = new Set(['node_modules', 'bower_components', 'jspm_packages']);
  const skippedPaths = new Set(skippedDirectories.map((dir) => path.resolve(rootDir, dir)));
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      if (entry.name.startsWith('.')) return;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skippedNames.has(entry.name) && !skippedPaths.has(entryPath)) walk(entryPath);
      } else if (entry.isFile() && JS_EXTENSION_REGEX.test(entry.name)) {
        files.push(entryPath);
      }
    });
  };
  walk(path.resolve(rootDir));
  return files;
}

interface BootstrapPartition {
  /** rootDir-relative paths for the tsconfig "exclude". */
  bootstrapFiles: string[];
  /** The files the migration will convert. */
  migratedFiles: string[];
}

function detectBootstrapFiles(rootDir: string, ignoredDirectories: string[]): BootstrapPartition {
  const candidates = partitionGitignored(
    rootDir,
    findJsFiles(rootDir, ignoredDirectories),
  ).kept;
  const partition = partitionBootstrapFiles(rootDir, candidates);
  logApplicationEntries(rootDir, partition.applicationEntries);
  return {
    bootstrapFiles: partition.bootstrap
      .map(({ file }) => path.relative(rootDir, file).split(path.sep).join('/'))
      .sort(),
    migratedFiles: partition.kept,
  };
}

// Written directly instead of shelling out to `npx tsc --init`: in a project
// without a local typescript install, npx resolves the npm placeholder
// package named `tsc` and the command fails. Recent `tsc --init` output is
// also a poor migration starting point ("types": [] hides @types packages,
// and flags like verbatimModuleSyntax bury converted files in suppressions
// unrelated to their actual types).
interface DefaultConfig {
  text: string;
  /**
   * Only for a project whose bundler resolves asset imports and has no type
   * package that declares them; null everywhere else.
   */
  assetDeclarations: AssetDeclarations | null;
}

function defaultConfig(rootDir: string): DefaultConfig {
  let isEsm = false;
  // The classic transform expects `import React` in scope, which is how
  // pre-17 code is written; 17+ may rely on the automatic runtime instead.
  let jsx = 'react';
  let packageJson: PackageJson | null = null;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
    isEsm = packageJson?.type === 'module';
    const reactRange: string =
      packageJson?.dependencies?.react ??
      packageJson?.devDependencies?.react ??
      packageJson?.peerDependencies?.react ??
      '';
    const reactMajor = parseInt(reactRange.replace(/^[^0-9]*/, ''), 10);
    if (reactMajor >= 17) {
      jsx = 'react-jsx';
    }
  } catch {
    // No parseable package.json; keep the CommonJS + classic-JSX defaults.
  }

  const bundler = detectBundler(rootDir, packageJson);
  const nodeModuleSetting = isEsm ? 'nodenext' : 'commonjs';
  const moduleSetting = bundler ? 'esnext' : nodeModuleSetting;
  const moduleResolutionField = bundler
    ? `
    // The bundler, not node, resolves this project's imports: extensionless
    // relative paths stay valid and import.meta is available.
    "moduleResolution": "bundler",`
    : '';
  if (bundler) {
    log.info(`Detected ${bundler.name} (${bundler.evidence}); writing bundler module settings.`);
  }

  const pathAliases = detectPathAliases(rootDir, bundler);
  const pathAliasesField = pathAliases ? renderPathAliases(pathAliases) : '';
  if (pathAliases) logPathAliases(pathAliases);

  const typesPackages = installedTypesPackages(rootDir);
  const viteClient = bundler?.name === 'vite' && hasViteClientTypes(rootDir);
  const typesEntries = viteClient ? [...typesPackages, 'vite/client'] : typesPackages;
  const preflight = preflightTypesPackages(rootDir);
  if (bundler?.name === 'webpack' && !typesPackages.includes('webpack-env')) {
    log.warn(
      'webpack-only globals (require.context, module.hot, __webpack_public_path__) have no ' +
        'types here, so every use collects a suppression. Install @types/webpack-env ' +
        `(${preflight.installCommand} @types/webpack-env)` +
        (typesEntries.length > 0
          ? ' and add "webpack-env" to the "types" array in the generated tsconfig.json'
          : '') +
        '.',
    );
  }
  // The evidence half of the types report needs a program and cannot run until
  // the migration is over; what package.json alone answers can be said here,
  // before the run that would suppress those errors.
  const preflightText = formatTypesPackagePreflight(preflight, typesEntries.length > 0);
  if (preflightText) log.warn(preflightText);
  const typesField =
    typesEntries.length > 0
      ? `,
    // @types packages present at migration time, pinned because TypeScript 6
    // no longer loads node_modules/@types automatically. Add new @types
    // packages here after installing them.${
      viteClient
        ? `
    // "vite/client" declares import.meta.env and the asset imports Vite
    // resolves (*.svg, *.css, ?raw, and the rest).`
        : ''
    }
    "types": [${typesEntries.map((name) => `"${name}"`).join(', ')}]`
      : '';

  // An explicit "exclude" replaces TypeScript's built-in one, so its entries
  // come along whenever gitignored directories or bootstrap files are added.
  const defaultExcludes = ['node_modules', 'bower_components', 'jspm_packages'];
  const ignoredDirectories = listGitignoredDirectories(rootDir).filter(
    (dir) => !defaultExcludes.includes(dir),
  );
  const { bootstrapFiles, migratedFiles } = detectBootstrapFiles(rootDir, ignoredDirectories);
  const excludeComments = [
    ignoredDirectories.length > 0
      ? `
  // Gitignored directories present at init time, so generated output is
  // neither type-checked nor migrated. Imports reaching into them still
  // resolve.`
      : '',
    bootstrapFiles.length > 0
      ? `
  // Build system files (configs and scripts run with node) present at init
  // time, kept as JavaScript so the build still boots.`
      : '',
  ].join('');
  const excludeField =
    ignoredDirectories.length > 0 || bootstrapFiles.length > 0
      ? `,${excludeComments}
  "exclude": [${[...defaultExcludes, ...ignoredDirectories, ...bootstrapFiles]
    .map((entry) => `"${entry}"`)
    .join(', ')}]`
      : '';

  // Vite declares the asset imports it resolves in "vite/client"; webpack
  // has no equivalent, so the project's own imports are the only evidence.
  const assetDeclarations =
    bundler?.name === 'webpack'
      ? buildAssetDeclarations(rootDir, migratedFiles, packageJson)
      : null;

  const text = `{
  // Created by ts-migrate. A starting point for a migrated project;
  // adjust as your codebase needs (see the ts-migrate README FAQ).
  "compilerOptions": {
    "target": "esnext",
    "module": "${moduleSetting}",${moduleResolutionField}${pathAliasesField}
    // Renamed CommonJS files often have no import/export statements yet;
    // without this they would be treated as scripts sharing one global scope.
    "moduleDetection": "force",
    "jsx": "${jsx}",
    "esModuleInterop": true,
    // Files a staged migration has not converted yet still resolve, so
    // imports crossing into the JavaScript side type as their contents
    // instead of erroring. Only the rename step converts those files.
    "allowJs": true,
    // JSON imports (package.json, fixtures, locale data) type as their
    // contents instead of failing to resolve.
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true${typesField}
  }${excludeField}
}
`;
  return { text, assetDeclarations };
}

/**
 * Writes the tsconfig, reporting a failure rather than letting one reach the
 * process. A checkout the run cannot write to is the environment, not a bug in
 * ts-migrate, and the crash handler would say otherwise over a stack trace.
 */
function writeConfigFile(configFile: string, text: string): boolean {
  try {
    fs.writeFileSync(configFile, text);
  } catch (err) {
    log.error(`Could not write ${configFile}: ${errorMessage(err)}`);
    return false;
  }
  log.info(`Config file created at ${configFile}`);
  return true;
}

/** Whether the tsconfig was written. False is reported, never thrown. */
export default function init({ rootDir, isExtendedConfig = false }: InitParams): boolean {
  if (!fs.existsSync(rootDir)) {
    log.error(`${rootDir} does not exist`);
    return false;
  }

  const configFile = path.resolve(rootDir, 'tsconfig.json');
  if (fs.existsSync(configFile)) {
    log.info(`Config file already exists at ${configFile}`);
    return true;
  }

  if (isExtendedConfig) {
    return writeConfigFile(configFile, extendedConfig);
  }

  const { text, assetDeclarations } = defaultConfig(rootDir);
  if (!writeConfigFile(configFile, text)) return false;

  if (!assetDeclarations) return true;
  // The tsconfig is already written, so a declarations file that cannot be
  // written costs the asset imports their types and nothing else.
  try {
    writeAssetDeclarations(assetDeclarations);
  } catch (err) {
    log.warn(
      `Could not write ${assetDeclarations.filePath}: ${errorMessage(err)}. Asset imports will ` +
        'collect a suppression instead of typing.',
    );
    return true;
  }
  if (fs.existsSync(assetDeclarations.filePath) && !isIncludedByTsConfig(rootDir, assetDeclarations.filePath)) {
    log.warn(
      `${assetDeclarations.filePath} is not matched by the generated tsconfig, so the ` +
        'declarations have no effect. Add the file to "include" or move it out of an ' +
        'excluded directory.',
    );
  }
  return true;
}
