import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import { listGitignoredDirectories } from '../utils/gitignore';

interface InitParams {
  rootDir: string;
  isExtendedConfig: boolean;
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

// Written directly instead of shelling out to `npx tsc --init`: in a project
// without a local typescript install, npx resolves the npm placeholder
// package named `tsc` and the command fails. Recent `tsc --init` output is
// also a poor migration starting point ("types": [] hides @types packages,
// and flags like verbatimModuleSyntax bury converted files in suppressions
// unrelated to their actual types).
function defaultConfig(rootDir: string): string {
  let isEsm = false;
  // The classic transform expects `import React` in scope, which is how
  // pre-17 code is written; 17+ may rely on the automatic runtime instead.
  let jsx = 'react';
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
    isEsm = packageJson.type === 'module';
    const reactRange: string =
      packageJson.dependencies?.react ??
      packageJson.devDependencies?.react ??
      packageJson.peerDependencies?.react ??
      '';
    const reactMajor = parseInt(reactRange.replace(/^[^0-9]*/, ''), 10);
    if (reactMajor >= 17) {
      jsx = 'react-jsx';
    }
  } catch {
    // No parseable package.json; keep the CommonJS + classic-JSX defaults.
  }

  const typesPackages = installedTypesPackages(rootDir);
  const typesField =
    typesPackages.length > 0
      ? `,
    // @types packages present at migration time, pinned because TypeScript 6
    // no longer loads node_modules/@types automatically. Add new @types
    // packages here after installing them.
    "types": [${typesPackages.map((name) => `"${name}"`).join(', ')}]`
      : '';

  // An explicit "exclude" replaces TypeScript's built-in one, so its entries
  // come along whenever gitignored directories are added.
  const defaultExcludes = ['node_modules', 'bower_components', 'jspm_packages'];
  const ignoredDirectories = listGitignoredDirectories(rootDir).filter(
    (dir) => !defaultExcludes.includes(dir),
  );
  const excludeField =
    ignoredDirectories.length > 0
      ? `,
  // Gitignored directories present at init time, so generated output is
  // neither type-checked nor migrated. Imports reaching into them still
  // resolve.
  "exclude": [${[...defaultExcludes, ...ignoredDirectories]
    .map((dir) => `"${dir}"`)
    .join(', ')}]`
      : '';

  return `{
  // Created by ts-migrate. A starting point for a migrated project;
  // adjust as your codebase needs (see the ts-migrate README FAQ).
  "compilerOptions": {
    "target": "esnext",
    "module": "${isEsm ? 'nodenext' : 'commonjs'}",
    // Renamed CommonJS files often have no import/export statements yet;
    // without this they would be treated as scripts sharing one global scope.
    "moduleDetection": "force",
    "jsx": "${jsx}",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true${typesField}
  }${excludeField}
}
`;
}

export default function init({ rootDir, isExtendedConfig = false }: InitParams): void {
  if (!fs.existsSync(rootDir)) {
    log.error(`${rootDir} does not exist`);
    return;
  }

  const configFile = path.resolve(rootDir, 'tsconfig.json');
  if (fs.existsSync(configFile)) {
    log.info(`Config file already exists at ${configFile}`);
    return;
  }

  if (isExtendedConfig) {
    fs.writeFileSync(configFile, extendedConfig);
  } else {
    fs.writeFileSync(configFile, defaultConfig(rootDir));
  }

  log.info(`Config file created at ${configFile}`);
}
