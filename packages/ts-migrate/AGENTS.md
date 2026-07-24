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
5. **Gitignored files are skipped by default.** Build output inside the
   source tree (bundles, `dist`, coverage) is neither renamed, migrated,
   type-checked, nor counted; `init` also writes the gitignored directories
   into the generated tsconfig's `exclude`. Runs log what they skipped. If a
   migration seems to miss files, check whether git ignores them; pass
   `--no-gitignore` to include them deliberately.
6. **Build system files stay JavaScript by default.** Configs and scripts
   that must keep running under plain Node (`webpack.config.js`,
   `jest.config.js`, paths run via `node scripts/build.js`, and the files
   they require) are kept out of rename and migrate so the build still
   boots; `init` writes them into the generated tsconfig's `exclude`. Runs
   log every kept file with its evidence. Pass `--no-bootstrap` to convert
   them anyway, e.g. when the project loads TypeScript configs through
   ts-node or tsx.
7. **Requirements:** Node >= 18.18. TypeScript 5.x or 6.x if the target
   project has TypeScript installed; if it has none, ts-migrate falls back to
   its own bundled compiler and plain JS projects work out of the box.
8. **The migration runs the project's own compiler.** `migrate`, `reignore`,
   and `check` load the `node_modules/typescript` found by searching from
   `<folder>` upward, not the one npx resolved for ts-migrate, because every
   suppression written is derived from what that compiler reports. The first
   line of a run names the copy in use, for example
   `TypeScript 5.7.3 (project: /repo/node_modules/typescript)`. A project with
   no typescript, or one outside `>=5.0 <7`, falls back to the bundled
   compiler with a warning. Pass `--typescript <path>` (the package directory
   or any file inside it) to name a compiler that is not under
   `node_modules`, or to force a specific one; `ts-migrate-full` applies it to
   the migrate step and the final compile check alike.

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
- If the run created commits, consider a repo-root `.git-blame-ignore-revs`
  so blame skips the mechanical rewrites; the run's final checklist prints
  the SHAs and the caveats per merge workflow (see `--blame-ignore-revs`).

## Commands

### `ts-migrate-full <folder> [flags]`

Runs the whole pipeline: init tsconfig → rename JS/JSX to TS/TSX → migrate →
verify with `tsc --noEmit`.

- `--yes` (`-y`): skip the interactive prompts (accept defaults).
- `--no-commit`: do not create git commits after each step.
- `--blame-ignore-revs`: append the SHAs of the commits this run creates to a
  `.git-blame-ignore-revs` file at the repository root so `git blame` can
  skip the mechanical rewrites. Only useful on merge-commit workflows; with
  squash or rebase merges those SHAs never reach the main branch, so leave
  the flag off and add the merged commit's SHA to the file after the merge
  instead. A successful run prints the SHAs and this guidance either way;
  the flag is ignored with `--no-commit`.
- `--version` (`-v`): print the ts-migrate version and exit.
- `--typescript <path>`: run the migrate step and the final `tsc --noEmit`
  check with the compiler at `<path>`. Without it, both use whatever compiler
  the migrate step resolved (the project's own, when it has one).
- All other flags are forwarded to the underlying `rename` and `migrate`
  commands (e.g. `--sources`, `--no-inferTypes`, `--exclude-plugin`).
  Exception: `--dry-run` is rejected here, because each pipeline step builds
  on the previous step's writes; preview with the individual commands
  instead.

### `ts-migrate init <folder>` / `ts-migrate init:extended <folder>`

Writes a migration-friendly `tsconfig.json` in `<folder>` (no-op if one
exists). Installed `@types` packages are pinned in a `types` array so that
TypeScript 5 (which loads `node_modules/@types` automatically) and
TypeScript 6 (which does not) check the project identically; add new
`@types` packages to that array after installing them. Gitignored
directories and detected build system files present at init time land in
the config's `exclude` (together with TypeScript's defaults, which an
explicit `exclude` would otherwise replace) so the project's own `tsc`
skips build output and keeps the build's own files JavaScript.
`init:extended` writes a config extending a shared base instead.

### `ts-migrate rename <folder> [-s <glob>]`

Renames `.js`/`.jsx` to `.ts`/`.tsx` (JSX content detected per file).
Gitignored files are skipped (`--no-gitignore` renames them too). Build
system files are kept as JavaScript with a log line naming each file and
its evidence (`--no-bootstrap` renames them too; a tsconfig `exclude`
entry keeps a specific file out for good). `--dry-run` prints the full
old-to-new mapping (surfacing each `.ts` vs `.tsx` decision) and renames
nothing. `--jsonSummary <file>` writes the old and new path of every
renamed file as JSON (see "Machine-readable summaries" below).

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
- `--no-gitignore`: also migrate gitignored files. By default they are kept
  out of the program entirely (neither parsed nor edited; files imported by
  migrated code and the tsconfig's `.d.ts` files stay in for type
  resolution).
- `--no-bootstrap`: also migrate build system files. By default they are
  kept out of the program the same way, so they stay JavaScript even under
  a hand-written tsconfig with `allowJs`.
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
- `--aliases tsfixme`: use `$TSFixMe`/`$TSFixMeFunction` instead of plain
  `any`. If the project does not already declare those globals, the migration
  writes them to `ts-migrate-aliases.d.ts` in `<folder>` so the output still
  compiles.
- `--dry-run`: run every plugin pass but write nothing to disk. Prints each
  file a real run would update, with the suppression and `any` counts it
  would then contain. The report matches a real run exactly (with
  `--aliases`, the declaration file is modeled in memory), and the run takes
  as long as a real one. Diffs are not printed; run for real on a clean git
  tree and use `git diff`.
- `--jsonSummary <file>`: write a JSON summary of the run to `<file>`: the
  changed files, per-plugin change counts, and the suppression and `any`
  counts in the changed files (see "Machine-readable summaries" below).
- `--typescript <path>`: run with the compiler at `<path>` instead of the one
  found by searching from `<folder>` upward (critical fact 8).

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
- `--no-gitignore`: same behavior as in `migrate`.
- `--no-bootstrap`: same behavior as in `migrate`.
- `--dry-run`: same preview behavior as `migrate`.
- `--jsonSummary <file>`: same machine-readable summary as `migrate`.
- `--typescript <path>`: same compiler override as `migrate`. A scoped
  migration reignored later must use the same compiler, or the suppressions
  will not match.

Both `migrate` and `reignore` end the run by printing a one-paragraph type
debt summary (the `report` totals for the project).

### `ts-migrate report <folder> [--json]`

Measures the type debt left in the project: `@ts-expect-error`/`@ts-ignore`
comments (with the suppressed error codes ts-migrate embeds in them),
any-alias annotations (`$TSFixMe` and friends, discovered from the aliases
the project's `.d.ts` files declare rather than hardcoded), and explicit
`any` annotations. Prints totals plus the 10 worst files and how many more
have debt. Counts come from per-file ASTs, so strings and JSX text that
merely contain the directive words are not counted. Gitignored files are
not counted (`--no-gitignore` counts them; same flag on `check`). `--json`
prints the same data as JSON, with every file listed.

### `ts-migrate check <folder> [--update-baseline]`

Enforcement mode of the same scanner, meant for CI. The first run writes a
per-file baseline to `.ts-migrate-baseline.json` in `<folder>`; commit that
file. Later runs exit nonzero if any per-file count exceeds the baseline,
and lower the baseline automatically when counts improve. After an
intentional increase, accept the new counts with `--update-baseline`.
`--baselineFile <path>` overrides the baseline location.

### `ts-migrate agents`

Prints this document.

## Machine-readable summaries (`--jsonSummary`)

`rename`, `migrate`, and `reignore` accept `--jsonSummary <file>` and write a
JSON summary of the run there; stdout stays human-oriented. Common fields:
`command`, `tsMigrateVersion`, `rootDir`, `exitCode`, `dryRun`. Paths in the
summary are relative to `<folder>`. When `dryRun` is true the summary
describes what a real run would have changed (nothing was written except the
summary file itself); combining `--dry-run` with `--jsonSummary` is the
machine-readable preview. Per command:

- `rename`: `renamedFiles` as `{"from": "src/a.js", "to": "src/a.ts"}` pairs.
- `migrate` and `reignore`: `changedFiles` (every file the run modified),
  `nonMigratedFilesWithSyntaxErrors` (files that will keep failing `tsc` and
  that re-running cannot fix), `plugins` (`{"name", "changedFileCount"}` per
  pipeline step, in order), and `changedFilesTypeDebt` (the suppression,
  any-alias, and `any` totals now present in the changed files, with the
  suppressed error codes; `null` if that scan failed).
- All three also report `skippedGitignoredFiles`, the number of files the
  run left untouched because git ignores them (0 with `--no-gitignore`),
  and `skippedBootstrapFiles`, the build system files kept as JavaScript
  as `{"file", "reason"}` pairs (empty with `--no-bootstrap`).

How to read a run from the outside:

- Exit `0` and the file exists: success; the summary is the source of truth
  for what changed.
- Nonzero exit and the file exists: the run completed with errors; the file's
  `exitCode` field matches the process exit code.
- Nonzero exit and no file: the command failed before running (bad flags,
  missing tsconfig.json), or the summary file itself could not be written.

The debt counts are scoped to this run's changed files; project-wide counts
come from `report --json`. `ts-migrate-full` forwards extra flags to both its
rename and migrate steps, so a `--jsonSummary` passed there is written by
rename and then overwritten by migrate; run the commands individually when you
need both summaries.

## Exit codes and failure modes

- `migrate`/`reignore` exit `0` on success and nonzero (255) if a plugin
  errored or a file still has syntax errors after migration.
- `check` exits `1` when a per-file count exceeds the baseline; `report` and
  `check` exit nonzero (255) if the tsconfig cannot be read.
- `ts-migrate-full` stops at the first failing step; the final `tsc` check
  failing means the migration did not reach a compiling state. Its failure
  message distinguishes the common causes: TS2578 (the check ran a different
  compiler than the migration, which is left only by a custom tsc path or a
  project compiler outside the supported range; run both with the compiler
  named in the migration log, then `reignore`), TS1xxx syntax errors in
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
2. No `.js`/`.jsx` sources remain except intentional ones: gitignored build
   output and the build system files the run kept, both named in the run
   logs and in `--jsonSummary`. A stray `.js` file outside those lists
   usually means the tsconfig selection missed it.
3. Suppression count is reasonable:
   `npx -p @obiemunoz/ts-migrate ts-migrate report <folder>` prints the
   totals, the suppressed error codes, and the worst files. If most
   suppressed codes are TS2304/TS2582 (globals like `require` or
   `describe`), environment types are missing; install them and re-run
   `reignore` instead of editing files.
4. Optional, recommended on repos with CI:
   `npx -p @obiemunoz/ts-migrate ts-migrate check <folder>` writes a
   `.ts-migrate-baseline.json`; commit it and run `check` in CI so the
   build fails when suppression or `any` counts creep back up.
