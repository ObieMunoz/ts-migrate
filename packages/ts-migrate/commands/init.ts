import fs from 'fs';
import path from 'path';
import log from 'updatable-log';

interface InitParams {
  rootDir: string;
  isExtendedConfig: boolean;
}

const extendedConfig = `{
  "extends": "../typescript/tsconfig.base.json",
  "include": [".", "../typescript/types"]
}
`;

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
  } catch (e) {
    // No parseable package.json; keep the CommonJS + classic-JSX defaults.
  }

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
    "skipLibCheck": true
  }
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
