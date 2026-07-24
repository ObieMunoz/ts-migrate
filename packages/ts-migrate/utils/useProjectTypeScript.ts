import log from 'updatable-log';
import {
  TypeScriptDecision,
  installTypeScriptResolution,
  migrationRootFromArgv,
  resolveTypeScript,
  typeScriptOverrideFromArgv,
} from './resolveTypeScript';

/**
 * Chooses the compiler for this run and redirects the process at it. Kept in
 * its own module because cli.ts has to import it before everything else: the
 * packages it imports load a compiler at module scope, and a redirect
 * installed after the first `require('typescript')` reaches nobody.
 */
function chooseTypeScript(): TypeScriptDecision {
  const argv = process.argv.slice(2);
  try {
    return resolveTypeScript({
      rootDir: migrationRootFromArgv(argv, process.cwd()),
      override: typeScriptOverrideFromArgv(argv),
    });
  } catch (err) {
    // An explicit --typescript that names no compiler: falling back would
    // reintroduce the version skew the flag was passed to avoid.
    log.error(err instanceof Error ? err.message : err);
    return process.exit(1);
  }
}

const decision = chooseTypeScript();
installTypeScriptResolution(decision.packageDir);

export default function typeScriptDecision(): TypeScriptDecision {
  return decision;
}
