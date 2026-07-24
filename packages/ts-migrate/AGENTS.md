# ts-migrate agent playbook

Instructions for AI coding agents driving the ts-migrate CLI to migrate a
JavaScript project to TypeScript. Print the copy matching your installed
version with `npx -p @obiemunoz/ts-migrate ts-migrate agents`. Human-oriented
docs live in this package's README.md.

## Critical facts

1. **The package is scoped.** A bare `npx ts-migrate ...` or
   `npx ts-migrate-full ...` downloads the unmaintained upstream `ts-migrate`
   package (TypeScript 4 era) instead of this fork. Either install
   `@obiemunoz/ts-migrate` as a devDependency first, or pass `-p` on every npx
   call: `npx -p @obiemunoz/ts-migrate ts-migrate-full <folder>`.
   `ts-migrate --version` (or `-v`) prints the installed version; the upstream
   CLI has no version flag and errors, so this is a quick check for which
   package npx fetched.
2. **`ts-migrate-full` prompts before starting.** Pass `--yes` to skip the
   prompts. Without `--yes` and without stdin, the run exits nonzero before
   doing anything.
3. **`ts-migrate-full` creates git commits** after each step by default. Pass
   `--no-commit` to leave every change in the working tree instead — do this
   when you manage commits yourself or the target is not a git repository.
4. **Suppressions in the output are success, not failure.** The tool's
   contract is that `tsc` compiles with zero errors afterwards; it fulfills it
   by annotating what it can prove and suppressing the rest with
   `@ts-expect-error` comments and `any`. Do not try to hand-fix every
   suppression; follow the workflow below to eliminate the bulk of them.
5. **Requirements:** Node >= 18.18. TypeScript 5.x or 6.x if the target
   project has TypeScript installed; if it has none, ts-migrate falls back to
   its own bundled compiler and plain JS projects work out of the box.

## Recommended workflow (full migration)

```sh
# 0. Preflight — from the target project's root:
#    - working tree clean, on a fresh branch
#    - dependencies installed (npm install / pnpm install / yarn install)
#    - environment types installed FIRST; this typically prevents the
#      majority of suppressions (require, process, describe, it, ...):
npm i -D @types/node          # plus your test runner's types:
                              # jest -> @types/jest, mocha -> @types/mocha,
                              # vitest -> add "vitest/globals" to tsconfig "types"

# 1. Migrate. <folder> is the project (or sub-project) root, the directory
#    where tsconfig.json belongs.
npx -p @obiemunoz/ts-migrate ts-migrate-full <folder> --yes --no-commit

# 2. Read the "Type definition recommendations" report printed at the end of
#    the run. Install what it recommends, e.g.:
npm i -D @types/jest
#    If the generated tsconfig pins a "types" array (it does whenever @types
#    packages were installed at init time), also add the new package there,
#    e.g. "jest" — the report says so when it applies.

# 3. Re-run reignore: it strips every suppression the new types resolve and
#    prints an updated recommendations report. If step 1 was scoped with
#    --sources, repeat the same flags here.
npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>

# 4. Verify:
npx tsc -p <folder>/tsconfig.json --noEmit   # must exit 0
```

Afterwards, update the project plumbing the tool deliberately does not touch:

- Add a way to produce/run JS again: a `tsc` build step or a TS-aware runner
  (tsx, ts-node). Point `package.json` `main` at output that exists.
- Update scripts that reference old `.js` paths (mocha globs, jest patterns).
- Teach ESLint about TypeScript (`@typescript-eslint` parser + plugin).

## Commands

### `ts-migrate-full <folder> [flags]`

Runs the whole pipeline: init tsconfig → rename JS/JSX to TS/TSX → migrate →
verify with `tsc --noEmit`.

- `--yes` (`-y`): skip the interactive prompts (accept defaults).
- `--no-commit`: do not create git commits after each step.
- `--version` (`-v`): print the ts-migrate version and exit.
- All other flags are forwarded to the underlying `rename` and `migrate`
  commands (e.g. `--sources`, `--no-inferTypes`, `--exclude-plugin`).

### `ts-migrate init <folder>` / `ts-migrate init:extended <folder>`

Writes a migration-friendly `tsconfig.json` in `<folder>` (no-op if one
exists). Installed `@types` packages are pinned in a `types` array so that
TypeScript 5 (which loads `node_modules/@types` automatically) and
TypeScript 6 (which does not) check the project identically; add new
`@types` packages to that array after installing them. `init:extended`
writes a config extending a shared base instead.

### `ts-migrate rename <folder> [-s <glob>]`

Renames `.js`/`.jsx` to `.ts`/`.tsx` (JSX content detected per file).

### `ts-migrate migrate <folder> [flags]`

Runs the codemod pipeline on an already-renamed project: re-points stale
relative imports, converts React propTypes to types, infers types from usage,
annotates remaining implicit `any`s, and suppresses residual compiler errors
with `@ts-expect-error` so the project compiles.

- `--sources <glob>` (`-s`, repeatable): migrate only a subset. Quote globs.
  Ambient `.d.ts` files matched by the tsconfig `include` (vite-env.d.ts,
  custom globals) are kept in the program automatically; pass
  `--no-ambientSources` to disable that. The rare package that ships
  unimported globals outside `@types` still needs a manual re-include,
  e.g. `-s "node_modules/some-package/globals.d.ts"`.
- `--no-inferTypes`: skip type inference and annotate plain `any`. Much
  faster; use on very large projects or when annotation quality is secondary.
- `--maxStablePasses <n>` (default 5): cap the repeat passes of the
  inference stage.
- `--plugin <name>`: run a single plugin instead of the pipeline.
- `--exclude-plugin <name>` (repeatable): run the default pipeline without the
  named plugin; every occurrence is removed (`eslint-fix` runs twice). Unknown
  names error and list the valid ones. For a staged migration that surfaces
  residual errors for manual fixing instead of suppressing them, pass
  `--exclude-plugin ts-ignore --exclude-plugin strip-ts-ignore`; pass
  `--exclude-plugin eslint-fix` to keep lint-autofix churn out of the diff.
  Excluding `infer-types` is equivalent to `--no-inferTypes`.
- `--aliases tsfixme`: use `$TSFixMe` instead of `any` (only if the project
  defines that global alias).

### `ts-migrate reignore <folder> [flags]`

For an already-TypeScript project that stopped compiling (dependency
upgrades, new types) or right after installing `@types` packages: strips all
existing suppression comments, then re-adds only the ones still needed.

- `--sources <glob>` (`-s`, repeatable): reignore only a subset. On a repo
  migrated one directory at a time, pass the same globs as the scoped
  migrate so files outside the subset are left untouched. Ambient `.d.ts`
  files from the tsconfig are kept automatically here too
  (`--no-ambientSources` disables).
- `-p`/`--messagePrefix`: customizes the comment text.

### `ts-migrate agents`

Prints this document.

## Exit codes and failure modes

- `migrate`/`reignore` exit `0` on success and nonzero (255) if a plugin
  errored or a file still has syntax errors after migration.
- `ts-migrate-full` stops at the first failing step; the final `tsc` check
  failing means the migration did not reach a compiling state. Its failure
  message distinguishes the common causes: TS2578 (compiler version skew —
  align typescript versions, then `reignore`), TS1xxx syntax errors in
  generated/third-party `.d.ts` files (fix, regenerate, or exclude them —
  the migrate step lists these files up front; re-running the migration
  cannot change them), and ordinary type errors (`reignore`).
- "eslint-fix skipped / could not parse" warnings are expected until the
  project's ESLint understands TypeScript; the migration is still valid.
- `rename` exits nonzero if `<folder>` has no `tsconfig.json` — run `init`
  first (`ts-migrate-full` does). A run that reports "No JS/JSX files to
  rename." succeeded but matched nothing: `<folder>` probably points at the
  wrong directory (e.g. a monorepo root instead of the package).

## Verifying a migration

1. `npx tsc -p <folder>/tsconfig.json --noEmit` exits 0.
2. No `.js`/`.jsx` sources remain except intentional ones (config files,
   build output).
3. Suppression count is reasonable: `grep -rn "@ts-expect-error" <folder>/src`
   — if most sit on globals like `require` or `describe`, environment types
   are missing; install them and re-run `reignore` instead of editing files.
