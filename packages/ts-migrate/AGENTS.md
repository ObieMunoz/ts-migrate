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
   they require) are kept out of rename so the build still boots; `init`
   writes them into the generated tsconfig's `exclude`. Runs log every kept
   file with its evidence. Pass `--no-bootstrap` to rename them anyway, e.g.
   when the project loads TypeScript configs through ts-node or tsx. In
   `migrate` and `reignore` the flag only decides whether those files are
   loaded into the program; nothing there edits JavaScript.
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
   the migrate step and the final compile check alike. Any compiler a minor or
   more away from the project's own install is warned about, at the start of
   the run and again at the end: the checker changes in every minor release,
   so the suppressions written are not the set the project's `tsc` reports.
   Patch differences are quiet.
9. **The eslint-fix step runs the project's own ESLint**, the
   `node_modules/eslint` found by searching from `<folder>` upward, because
   the project's config was written for that engine: a rule using the ESLint 8
   context API (`context.getScope()` and friends, removed in 9) throws under a
   newer engine, and those files come back with no lint fixes. The step prints
   the copy in use once, for example
   `[eslint-fix] ESLint 8.57.1 (project: /repo/node_modules/eslint)`. A project
   with no eslint, one below 8.0, or a flat config with an eslint below 8.57
   falls back to the ESLint bundled with ts-migrate. Pass `--no-projectEslint`
   to `migrate` or `reignore` to use the bundled one regardless.
10. **The ESLint config is resolved from `<folder>`, not the working
    directory**, so `ts-migrate migrate packages/app` from a repository root
    picks up `packages/app`'s own config and falls back to one above it. The
    config file is printed next to the engine line, for example
    `[eslint-fix] flat config: /repo/packages/app/eslint.config.js`. If that
    line names no file, or names one you did not expect, the lint pass is
    running against the wrong rules.

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
                              # and your bundler's, on a browser app:
                              # webpack -> @types/webpack-env
                              # vite -> nothing, init pins "vite/client"

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
#    --sources, repeat the same flags here. Add --casts to also retry the
#    `as any` assertions the migration inserted; it is slower.
npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>

# 4. Verify:
npx tsc -p <folder>/tsconfig.json --noEmit   # must exit 0
```

A run may also add `types/ts-migrate-modules.d.ts`, declaring the imported
packages that ship no type definitions. Commit it: without it those imports
are errors again. Delete a line from it once that package has real types
(a later run drops the entry on its own), and never add hand-written
declarations to it — ts-migrate rewrites the file.

On a webpack project, `init` also writes `types/ts-migrate-assets.d.ts`,
declaring the asset imports the bundler resolves and TypeScript does not
(`import logo from './logo.png'`, `import './App.css'`). Commit it too.
Only the extensions the project imports are declared, and only where the
loader cannot change the type: images, fonts and media get a `string`
default export, and an extension imported only for its side effects gets a
module with no exports. An extension imported by name, a style sheet bound
to a name (CSS modules), and `*.svg` in a project that has an svgr package
installed are all left undeclared, because only the loader knows what those
export and a wrong declaration type-checks while a suppression does not.
`init` names each one it skipped. Declare those yourself, in a file of your
own rather than in this one.

A run may also add `types/ts-migrate-globals.d.ts`, declaring the properties
the code assigns to `window`, `global` and `globalThis` so those reads and
writes type-check instead of taking a cast at each site. Commit it too. Its
types are the ones the assigned expressions state outright and the any alias
everywhere else, so narrowing one to the real shape is the useful edit and a
later run keeps it. Delete an entry once something else declares that
property, since two declarations of one global is an error. Do not add
entries by hand: the file is rewritten from its own declarations every run.

Afterwards, update the project plumbing the tool deliberately does not touch:

- Add a way to produce/run JS again: a `tsc` build step or a TS-aware runner
  (tsx, ts-node). Point the entry point fields the rename listed (`main`,
  `bin`, `exports`, and friends) at output that exists. Script paths and test
  globs were repointed for you; see `ts-migrate rename` below.
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
  the migrate step resolved (the project's own, when it has one). The
  interactive prompt for a custom tsc path is the only way the two steps end up
  on different compilers; a mismatch there stops the run before Step 1 rather
  than at the check. `--yes` sets no custom path, so it never applies.
- All other flags are forwarded to the underlying `rename` and `migrate`
  commands (e.g. `--sources`, `--no-inferTypes`, `--exclude-plugin`,
  `--no-projectEslint`, which is also repeated in the reignore hint printed
  on failure).
  Exception: `--dry-run` is rejected here, because each pipeline step builds
  on the previous step's writes; preview with the individual commands
  instead.

### `ts-migrate init <folder>` / `ts-migrate init:extended <folder>`

Writes a migration-friendly `tsconfig.json` in `<folder>` (no-op if one
exists). `resolveJsonModule` is on, so JSON imports type as their contents
instead of collecting a suppression each. `allowJs` is on (and `checkJs`
off), so a migration done one directory at a time resolves imports into the
directories it has not converted yet instead of suppressing each one; those
files are read for their types and never migrated in place.
The module settings follow the project: `commonjs`, or `nodenext` when
package.json declares `"type": "module"`, or `esnext` with
`"moduleResolution": "bundler"` when the project builds with Vite or webpack
(either one in `dependencies`/`devDependencies`, `react-scripts` for a
Create React App project, or a `vite.config.*`/`webpack.config.*` file in
`<folder>`). Bundler projects need
that third setting because the bundler resolves their imports, not node:
`import.meta` is TS1343 under `commonjs`, and extensionless relative imports
are TS2835 under `nodenext`. A Vite
project also gets `"vite/client"` in the `types` array when vite is
installed, which is what declares `import.meta.env` and the asset imports
(`*.svg`, `*.css`). For a webpack project, install `@types/webpack-env` so
`require.context` and `module.hot` type; init says so when it is missing.
A webpack project also gets `types/ts-migrate-assets.d.ts`, described below.
Installed `@types` packages are pinned in a `types` array so that
TypeScript 5 (which loads `node_modules/@types` automatically) and
TypeScript 6 (which does not) check the project identically; add new
`@types` packages to that array after installing them. Gitignored
directories and detected build system files present at init time land in
the config's `exclude` (together with TypeScript's defaults, which an
explicit `exclude` would otherwise replace) so the project's own `tsc`
skips build output and keeps the build's own files JavaScript.
`init:extended` writes a config extending a shared base instead.

### `ts-migrate rename <folder> [-s <glob>]`

Renames `.js`/`.jsx` to `.ts`/`.tsx` (JSX content detected per file), and
`.mjs`/`.cjs` to `.mts`/`.cts`. A `.mjs`/`.cjs` file keeps its extension
when a build tool loads it by name (`postcss.config.cjs`,
`eslint.config.mjs`, `.prettierrc.cjs`) or when it holds JSX, which
`.mts`/`.cts` cannot; both cases are logged with the file and the reason.
Gitignored files are skipped (`--no-gitignore` renames them too). Build
system files are kept as JavaScript with a log line naming each file and
its evidence (`--no-bootstrap` renames them too; a tsconfig `exclude`
entry keeps a specific file out for good). `--dry-run` prints the full
old-to-new mapping (surfacing each `.ts` vs `.tsx` decision) and renames
nothing. `--jsonSummary <file>` writes the old and new path of every
renamed file as JSON (see "Machine-readable summaries" below).

The rename also repoints the package.json references that follow
mechanically from the mapping, in every package.json from the directory of
a renamed file up to `<folder>`: the paths and globs in `scripts`, in the
`jest` block (`testMatch`, `collectCoverageFrom`, `setupFiles`,
`setupFilesAfterEnv`, `globalSetup`, `globalTeardown`) and in the `mocha`
block (`spec`, `require`). Only references that resolve to a file in the
mapping change, so a build system file kept as JavaScript keeps its `.js`
path (`"build": "node scripts/build.js"` is left alone). A glob is
rewritten to the new extension only when nothing it matched is still
JavaScript; when unmigrated files still match, or the matches renamed to
both `.ts` and `.tsx`, it is widened into a brace group instead
(`**/*.test.js` becomes `**/*.test.{js,ts}`). Edits are text splices, so
the file's formatting and key order survive.

Entry points are reported, not rewritten. `main`, `module`, `browser`,
`bin`, `exports`, `types`, `typings`, and `files` address the package from
the outside, and after a TypeScript conversion they need to name build
output rather than the renamed source, which the rename cannot produce.
Every one that still names a renamed file is logged, and listed in the
JSON summary, for you to repoint once a build step exists. An entry point
that names a build system file is absent from both lists, because that file
was never renamed: `"start": "node src/cli.js"` keeps `src/cli.js` as
JavaScript, so a `bin` pointing at it stays valid and needs no notice.

### `ts-migrate migrate <folder> [flags]`

Runs the codemod pipeline on an already-renamed project: re-points stale
relative imports, rewrites CommonJS `require`/`module.exports` into TypeScript
module syntax, declares the properties the code assigns to `window` and
`globalThis`, converts React propTypes to types, writes the type arguments
React hook calls need, infers types from usage, declares the properties
assigned onto empty object literals, annotates remaining implicit `any`s,
widens the annotations the file's own assignments contradict, and suppresses
residual compiler errors with `@ts-expect-error` so the project compiles.
Only TypeScript files are
migration targets. `.js`, `.jsx`, `.mjs` and `.cjs` are never edited, even
when a tsconfig with `allowJs` pulls them in; they stay in the program and
still type the files that import them. Run `rename` on a file to make it
migratable.

The CommonJS step matters on vanilla Node projects: left alone, `require()`
returns `any` and every import boundary in the project loses its types. It
emits `import x = require('m')` and `export = x` by default, which compile to
the same CommonJS and need no `esModuleInterop`, and named exports where a
named import has to reach them (`const { a } = require('m')`,
`module.exports = { a, b }`, `exports.a = ...`). Named exports add the
non-enumerable `__esModule` marker to the emitted module, which only a consumer
default-importing the whole module object through Babel-style interop can
observe. A file that is already ESM gets `import x from 'm'` and
`export default`. Dynamic, conditional and non top level forms are left for
ts-ignore, and the run reports each file it left alone and why. Pass
`--exclude-plugin convert-commonjs` to keep CommonJS syntax as it is.

The hook step covers `useState(null)`, `useState(undefined)`, `useState([])`,
`useState({})` and `useRef(null)`, whose initializers infer `null`,
`undefined`, `never[]` and `{}` and turn every later use into an error. It
only touches calls an existing error already blames, takes the arguments the
setter is called with (or, for a ref, the intrinsic tag it is attached to) as
the type, and writes it only when re-checking the file reports no new error.
A hook whose evidence leaves the file gets an `any` (`$TSFixMe`) type
argument, which is one visible any in place of the suppressions the call would
otherwise earn. Pass `--exclude-plugin react-hook-types` to leave hook calls
as they are.

The widening step unions an annotation with what the assignments in its own
file give it, so `let x: number` later assigned null ends up `number | null`
instead of `@ts-expect-error`. It only ever writes a type it can name in that
file without a new import, never touches parameter annotations, and caps how
wide an annotation may get, leaving anything else for the suppression pass.
Each widening is re-checked in isolation and dropped unless the errors it was
made for are gone and no new one appeared. A widened declaration other files
can see (an exported interface member, a property of an exported class) tells
them what it really holds, which can surface errors in those files on the same
run. Pass `--exclude-plugin widen-annotations` to keep annotations as written.

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
- `--no-bootstrap`: also load build system files into the program. By
  default they are kept out of it entirely. They stay JavaScript either
  way; only `rename` converts them.
- `--no-inferTypes`: skip type inference and annotate plain `any`. Much
  faster; use on very large projects or when annotation quality is secondary.
- `--maxStablePasses <n>` (default 5): cap the repeat passes of the
  inference stage.
- `--plugin <name>`: run a single plugin instead of the pipeline. Takes one
  name; repeating the flag is an error, since the subtractive case is
  `--exclude-plugin`. The plugin gets the same options it would get in the
  pipeline, so plugin flags such as `--defaultAccessibility` apply here too.
  A flag the named plugin has no option for is reported and ignored.
- `--exclude-plugin <name>` (repeatable): run the default pipeline without the
  named plugin; every occurrence is removed (`eslint-fix` runs twice). Unknown
  names error and list the valid ones. For a staged migration that surfaces
  residual errors for manual fixing instead of suppressing them, pass
  `--exclude-plugin ts-ignore --exclude-plugin strip-ts-ignore`; pass
  `--exclude-plugin eslint-fix` to keep lint-autofix churn out of the diff.
  Excluding `infer-types` is equivalent to `--no-inferTypes`.
- `--no-modernizeDefaultProps`: keep `Component.defaultProps = { ... }` on
  function components and type it, instead of moving the defaults into the
  props destructuring (`{ size = 'md' }`), making those props optional and
  deleting the assignment. React 19 ignores defaultProps on function
  components, so the conversion is on by default. It is made only where it
  cannot change behavior: literal default values, an object literal in the
  same file, nothing else reading the defaults or `Component.defaultProps`, a
  destructured props parameter that binds every defaulted prop, and a props
  type declared in full in that file. Everything else, class components
  included, keeps the assignment and is reported at the end of the run.
- `--aliases tsfixme`: use `$TSFixMe`/`$TSFixMeFunction` instead of plain
  `any`. If the project does not already declare those globals, the migration
  writes them to `ts-migrate-aliases.d.ts` in `<folder>` so the output still
  compiles.
- `--defaultAccessibility private|protected|public`: give every class member
  that declares no accessibility modifier this one. Off by default, so members
  keep the implicit `public`.
- `--privateRegex <regex>`, `--protectedRegex <regex>`, `--publicRegex <regex>`:
  give class members whose name matches the regex that modifier instead of
  `--defaultAccessibility`. The first match in that order wins, so
  `--privateRegex "^_"` marks underscore-prefixed members private and leaves
  the rest alone. All four flags feed the `member-accessibility` plugin, which
  runs in the default pipeline and under `--plugin member-accessibility`.
- `--no-declareUntypedModules`: suppress every import of a package that ships
  no type definitions, instead of declaring those packages once in
  `types/ts-migrate-modules.d.ts`. By default the run generates that file
  (only for packages the compiler reported as untyped), so those imports stay
  checkable imports typed `any` rather than N `@ts-expect-error` comments.
  Entries are kept across runs and dropped once their types resolve, so
  installing a real `@types` package retires one. A file at that path that
  ts-migrate did not write is never touched.
- `--no-declareGlobals`: cast every read and write of a property the code hangs
  off `window`, `global` or `globalThis`, instead of declaring those properties
  once in `types/ts-migrate-globals.d.ts`. By default the run generates that
  file and prints what it declared. Types are the ones the assigned expressions
  state outright and the any alias everywhere else, so narrowing one by hand is
  the useful edit and a later run keeps it. Entries are never dropped
  automatically: delete one once something else declares that property, since
  two declarations of one global is an error. A file at that path that
  ts-migrate did not write is never touched.
- `--dry-run`: run every plugin pass but write nothing to disk. Prints each
  file a real run would update, with the suppression and `any` counts it
  would then contain. The report matches a real run exactly (with
  `--aliases`, the declaration file is modeled in memory), and the run takes
  as long as a real one. Diffs are not printed; run for real on a clean git
  tree and use `git diff`.
- `--jsonSummary <file>`: write a JSON summary of the run to `<file>`: the
  changed files, per-plugin change counts, and the suppression and `any`
  counts in the changed files (see "Machine-readable summaries" below).
- `--suppressionReportFile <file>`: write what the compiler knew about every
  diagnostic the run suppressed to `<file>` (see "Suppression report" below).
- `--typescript <path>`: run with the compiler at `<path>` instead of the one
  found by searching from `<folder>` upward (critical fact 8).
- `--no-projectEslint`: run eslint-fix with the ESLint bundled with ts-migrate
  instead of the project's own (critical fact 9).

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
- `--casts`: also retry the `as any` assertions ts-migrate inserted. Each one
  is dropped, the file is re-checked, and the removal is kept only where no
  error appears that the file did not already have. Assertions to any other
  type are left alone. Off by default: it costs a validation pass per file
  holding one. Run it the way you run `reignore` itself, after installing
  `@types` packages or after a neighboring directory has been migrated, and
  read the reduction off `ts-migrate report`/`check`.
- `--no-gitignore`: same behavior as in `migrate`.
- `--no-bootstrap`: same behavior as in `migrate`.
- `--no-declareUntypedModules`: same behavior as in `migrate`.
- `--dry-run`: same preview behavior as `migrate`.
- `--jsonSummary <file>`: same machine-readable summary as `migrate`.
- `--typescript <path>`: same compiler override as `migrate`. A scoped
  migration reignored later must use the same compiler, or the suppressions
  will not match.
- `--no-projectEslint`: same lint engine override as `migrate`.
- `--suppressionReportFile <file>`: same suppression report as `migrate`.

Both `migrate` and `reignore` end the run by printing a one-paragraph type
debt summary (the `report` totals for the project).

### Suppression report

A suppression comment keeps the error code and 50 characters of the message.
Everything else the compiler knew is gone the moment the comment is written:
`getSemanticDiagnostics` does not report a diagnostic a directive already
suppressed, so no later command can recover it. `migrate` and `reignore` read
that evidence just before it is hidden and end the run with a grouped count of
what was suppressed and which fix each group needs. Pass
`--suppressionReportFile <file>` to also write the per-diagnostic detail:

- the full message through `flattenDiagnosticMessageText`, with every link of
  the elaboration chain and its own error code;
- the `relatedInformation` entries with their source locations, which name the
  missing argument or the declaration the type came from;
- per code, the checker evidence the message does not carry: the resolved
  signature and the callee's declaration site for `TS2554`, the parameter type
  against the argument type plus the missing and mismatched properties for
  `TS2345` and `TS2322`, both member declarations for `TS2416` and `TS2425`,
  and the paths the compiler tried for an unresolved `TS2307` module.

Type strings in the report are never abbreviated.

One entry is written per diagnostic, but ts-ignore writes at most one comment
per line. Where a line held more than one diagnostic, only the first reaches a
comment, so the per-code totals `ts-migrate report` scrapes match the report's
"commented" column, not its "diagnostics" column. The report states how many
diagnostics that covers.

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

- `rename`: `renamedFiles` as `{"from": "src/a.js", "to": "src/a.ts"}` pairs,
  `packageJsonRewrites` (the script paths and test globs it repointed, as
  `{"file", "key", "from", "to"}`), and `packageJsonNotices` (the entry point
  fields that still name a renamed file and were left for a build step, as
  `{"file", "key", "value", "target"}`).
- `migrate` and `reignore`: `changedFiles` (every file the run modified),
  `generatedFiles` (declaration files the run wrote itself, e.g.
  `types/ts-migrate-modules.d.ts` and `types/ts-migrate-globals.d.ts`, which
  are new files rather than edits),
  `nonMigratedFilesWithSyntaxErrors` (files that will keep failing `tsc` and
  that re-running cannot fix), `plugins` (`{"name", "changedFileCount"}` per
  pipeline step, in order), `pluginFailures` (files a plugin could not
  process, grouped by cause, as `{"plugin", "reason", "ruleId", "fileCount",
  "files"}`; empty when every plugin processed every file), and
  `changedFilesTypeDebt` (the suppression, any-alias, and `any` totals now
  present in the changed files, with the suppressed error codes; `null` if
  that scan failed).
- All three also report `skippedGitignoredFiles`, the number of files the
  run left untouched because git ignores them (0 with `--no-gitignore`),
  and `skippedBootstrapFiles`, the build system files kept as JavaScript
  as `{"file", "reason"}` pairs (empty with `--no-bootstrap`).

How to read a run from the outside:

- Exit `0` and the file exists: success; the summary is the source of truth
  for what changed. Check `pluginFailures`: a lint config that throws leaves
  files unchanged without failing the run, so a successful exit can still hide
  files no plugin could touch.
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

- A name that is not a command exits `1` and prints `Unknown command: <name>`,
  or `Did you mean <command>?` when it is close to a real one. Options are not
  checked the same way: one the command does not declare is accepted and
  ignored, because `ts-migrate-full` forwards a single argument list to both
  `rename` and `migrate` and the two accept different flags.
- `migrate`/`reignore` exit `0` on success and nonzero (255) if a plugin
  errored or a file still has syntax errors after migration.
- `check` exits `1` when a per-file count exceeds the baseline; `report` and
  `check` exit nonzero (255) if the tsconfig cannot be read.
- `ts-migrate-full` stops at the first failing step; the final `tsc` check
  failing means the migration did not reach a compiling state. Its failure
  message distinguishes the common causes: TS2578 (the check ran a different
  compiler than the migration, which is left only by a custom tsc path or a
  project compiler outside the supported range; align the two compilers first,
  because `reignore` under the skew re-derives the same suppressions, then
  `reignore`), TS1xxx syntax errors in
  generated/third-party `.d.ts` files (fix, regenerate, or exclude them —
  the migrate step lists these files up front; re-running the migration
  cannot change them), and ordinary type errors (`reignore`).
- "eslint-fix skipped / could not parse" warnings are expected until the
  project's ESLint understands TypeScript; the migration is still valid.
- "Error occurred in eslint-fix plugin" leaves that file unlinted but does not
  invalidate the migration. If the run line says the ESLint is bundled rather
  than the project's, the config is likely being run by an engine it was not
  written for; installing eslint in the project fixes the mismatch.
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
