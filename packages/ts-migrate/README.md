# @obiemunoz/ts-migrate

*ts-migrate is a tool for migrating frontend application to TypeScript.*
Run `npx -p @obiemunoz/ts-migrate ts-migrate-full <folder>` to convert your frontend application to TypeScript.

> **This is a maintained fork of [airbnb/ts-migrate](https://github.com/airbnb/ts-migrate), updated for TypeScript 5 and 6.** Original work © 2020 Airbnb (MIT).

*ts-migrate* was originally designed around Airbnb projects. Use at your own risk.


# Install

Install [*@obiemunoz/ts-migrate*](https://www.npmjs.com/package/@obiemunoz/ts-migrate) using [npm](https://www.npmjs.com):

`npm install --save-dev @obiemunoz/ts-migrate`

Or [pnpm](https://pnpm.io):

`pnpm add -D @obiemunoz/ts-migrate`

The CLI commands are still named `ts-migrate` and `ts-migrate-full`. Because the
package is scoped, one-off `npx` runs need the `-p @obiemunoz/ts-migrate` flag to
tell npx which package provides those commands: a bare `npx ts-migrate-full ...`
would download the unmaintained upstream `ts-migrate` package instead. The pnpm
equivalent is `pnpm --package=@obiemunoz/ts-migrate dlx ts-migrate-full ...`.
If you've installed `@obiemunoz/ts-migrate` as a devDependency of your project,
the commands are already in `node_modules/.bin`, so `npx ts-migrate-full <folder>`,
`pnpm ts-migrate-full <folder>`, or a package.json script all resolve to this fork.

# Usage

Migrate an entire project like this:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate-full <folder>
```
The `ts-migrate-full` command asks for confirmation before it starts and will perform a `git add` and `git commit` after each major step (_[details here]( https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate/bin/ts-migrate-full.sh )_). For unattended runs — scripts, CI, AI coding agents — pass `--yes` to skip the prompts and `--no-commit` to leave the changes uncommitted in the working tree.

Commit or stash the folder you are migrating before you start. The run lists anything uncommitted there before Step 1, because the rename and migrate steps rewrite those files whether or not commits are enabled, and with commits enabled `git add .` puts them in the migration's commits too. Without `--yes` the list sits above the confirmation prompt; with `--yes` it is a warning and the run continues.

A failing step names itself and exits with that step's exit code, leaving the partial result in the working tree. It also prints the type definition recommendations the run had gathered by then, and names the file they were written to so they survive the failure.

A successful run ends with the SHAs of the commits it created and guidance for recording them in a repo-root [`.git-blame-ignore-revs`](https://git-scm.com/docs/git-blame#Documentation/git-blame.txt---ignore-revs-fileltfilegt) file, so `git blame` (locally and on github.com) can skip the mechanical rewrite commits. If your team merges PRs with merge commits, pass `--blame-ignore-revs` to have the file written for you; with squash or rebase merges those SHAs never reach the main branch, so add the merged commit's SHA to the file after the merge instead.

Please note that it may take a long time to do a full migration.
You can also migrate individual parts of a project by specifying a subset of sources:

```sh
# Specify the project root and list the subset to migrate. Ambient declaration
# files from your tsconfig stay in the program automatically.
npx -p @obiemunoz/ts-migrate ts-migrate-full <folder> \
  --sources="relative/path/to/subset/**/*"
```

Or, you can run individual CLI commands (the help text lists them by bin name —
prefix with your runner: `npx ts-migrate ...` or `pnpm ts-migrate ...`):

```
$ npx -p @obiemunoz/ts-migrate ts-migrate --help

Usage: ts-migrate <command> [options]

Commands:
  ts-migrate init <folder>           Initialize tsconfig.json file in <folder>
  ts-migrate init:extended <folder>  Initialize tsconfig.json in <folder> extending a shared base
                                     config
  ts-migrate rename <folder>         Rename files in folder from JS/JSX to TS/TSX
  ts-migrate migrate <folder>        Fix TypeScript errors, using codemods
  ts-migrate reignore <folder>       Re-run ts-ignore on a project
  ts-migrate report <folder>         Print per-file counts of suppression comments and any-type
                                     annotations
  ts-migrate check <folder>          Compare suppression and any counts against a committed baseline
  ts-migrate agents                  Print usage instructions for AI coding agents (non-interactive
                                     playbook)

Options:
  -h, --help     Show help                                                                 [boolean]
  -v, --version  Show version number                                                       [boolean]

Examples:
  ts-migrate --help                             Show help
  ts-migrate migrate --help                     Show help for the migrate command
  ts-migrate init frontend/foo                  Create tsconfig.json file at
                                                frontend/foo/tsconfig.json
  ts-migrate init:extended frontend/foo         Create extended from the base tsconfig.json file at
                                                frontend/foo/tsconfig.json
  ts-migrate rename frontend/foo                Rename files in frontend/foo from JS/JSX to TS/TSX
  ts-migrate rename frontend/foo --s "bar/baz"  Rename files in frontend/foo/bar/baz from JS/JSX to
                                                TS/TSX
  ts-migrate agents                             Print the agent playbook

AI coding agents: run `npx -p @obiemunoz/ts-migrate ts-migrate agents` for the full non-interactive
usage playbook.
```

Help output wraps at 100 columns whether or not stdout is a terminal, and at the
terminal width when that is narrower, so a piped or redirected `--help` is
readable. A name that is not a command exits 1 and says so, suggesting the
closest real command when there is one:

```sh
$ npx -p @obiemunoz/ts-migrate ts-migrate migate frontend/foo
...
Did you mean migrate?
```

An argument past the ones a command declares is reported the same way, so
`ts-migrate report frontend/foo extra` exits 1 naming `extra` instead of
ignoring it.

An option a command does not declare is still accepted and ignored, because
`ts-migrate-full` forwards one argument list to both `rename` and `migrate` and
the two accept different flags.

Every command above takes a `<folder>`, and every one of them exits 255 before
reading or writing anything when that folder does not exist or is a file rather
than a directory. The message names the absolute path the argument resolved to,
so a relative path that landed somewhere unexpected shows where it went. An
empty directory is a directory: `init` writes a tsconfig into it and exits 0.

The `rename`, `migrate`, and `reignore` commands accept a `--sources` (or `-s`) flag. This flag
accepts a relative path to a subset of your project as a string (glob patterns are
allowed). When this flag is used, ts-migrate ignores your project's default source
files in favor of the ones you've listed. It is effectively the same as replacing
your tsconfig.json's `include` property with the provided sources. The flag can be
passed multiple times.

The `migrate` command starts by running the
[update-import-paths](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/update-import-paths.ts)
plugin: relative imports that still name the pre-rename file, like
`import foo from './foo.js'` or `'./foo.jsx'`, are re-pointed at the renamed
`.ts`/`.tsx` file (the extension is dropped, or kept as `.js` when the
importing file is ESM, either by its own `.mts` extension or by its package's
`"type": "module"`; a `.cts` file emits `.cjs` and stays CommonJS whatever
its package says, so its own imports keep the extensionless form). Imports
whose target still exists on disk are left alone, as are `./foo.mjs` and
`./foo.cjs` imports: `.mts` and `.cts` emit those same extensions, so the
import already names the file that ships.

The [convert-commonjs](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/convert-commonjs.ts)
plugin runs next, on the specifiers update-import-paths has already re-pointed.
Top level `require` and `module.exports` become TypeScript module syntax, so the
checker sees types across file boundaries instead of the `any` a `require()`
call returns. The default output is the interop pair that emits the same
CommonJS it replaced and needs no `esModuleInterop`:

- `const x = require('m')` becomes `import x = require('m')`
- `require('m')` becomes `import 'm'`
- `module.exports = <value>` becomes `export = <value>`

`const { a, b } = require('m')` becomes `import { a, b } from 'm'`, and
`module.exports = { a, b }` and `exports.a = ...` become `export const`/
`export { }`, because `export = <value>` cannot be reached by a named import.
Those add the non-enumerable `__esModule` marker to the emitted module:
`Object.keys(require('./m'))` is unchanged, but a consumer that
default-imports the whole module object through Babel-style interop sees
`undefined` where it used to see the exports object.

A file that is already ESM, by its `.mts` extension, by module syntax it
already contains, or by its package's `"type": "module"`, gets
`import x from 'm'` and `export default` instead; a `.cts` file never counts
as ESM here, whatever its package says or its syntax already looks like.
Requires and exports that are not statically analyzable top level statements,
including a require inside a function or a branch and a file that mixes
`module.exports = x` with `exports.foo = y`, are left for ts-ignore; the run
reports each file it left alone and why. Pass
`--exclude-plugin convert-commonjs` to keep the CommonJS syntax as it is.

The `migrate` command also accepts flags controlling the type-inference stage,
the most expensive part of a migration:

- `--no-inferTypes` skips the [infer-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/infer-types.ts)
  plugin and annotates every implicit any with plain `any` (the original
  ts-migrate behavior), which is much faster, at the cost of annotation quality.
- `--maxStablePasses <n>` (default 5) caps how many times the
  infer-types/explicit-any group repeats while files keep changing. Pass 1 does
  the bulk of the work; later passes resolve annotations that only become
  inferable after their callers were annotated.
- `--no-incrementalPasses` makes every repeat pass revisit all files, instead of
  only the files affected by the previous pass's changes (as computed from the
  import graph).

Individual steps of the default pipeline can be skipped with
`--exclude-plugin <name>` (repeatable, validated against the same plugin names
as `--plugin`; see `migrate --help` for the list). Every occurrence of the name
is removed: excluding `eslint-fix` drops both the lint pass before `ts-ignore`
and the one after it. Common uses:

```sh
# Staged migration: leave residual compiler errors visible for manual fixing
# instead of suppressing them with @ts-expect-error comments.
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> \
  --exclude-plugin ts-ignore --exclude-plugin strip-ts-ignore

# Keep lint-autofix churn out of the migration diff (and skip two lint passes).
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> --exclude-plugin eslint-fix
```

An unknown plugin name errors and lists the valid names. Excluding
`infer-types` is equivalent to `--no-inferTypes`. `ts-migrate-full` forwards
the flag to the migrate step, like any other migrate option.

`--plugin <name>` runs one plugin on its own instead of the pipeline. It takes
a single name; to run the pipeline without some of its plugins, use
`--exclude-plugin`. The plugin receives the same options it would receive in
the pipeline, so a plugin flag applies the same way in both:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> \
  --plugin member-accessibility --defaultAccessibility private
```

A flag the named plugin has no option for is reported and ignored, rather than
silently doing nothing.

Four flags feed the
[member-accessibility](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/member-accessibility.ts)
plugin, which runs in the default pipeline as well as under `--plugin`:

- `--defaultAccessibility private|protected|public` writes that modifier on
  every class member that declares none. Unset by default, so members keep the
  implicit `public`.
- `--privateRegex`, `--protectedRegex` and `--publicRegex` take a regular
  expression matched against the member name, and override
  `--defaultAccessibility` for the members they match. Private is tried first,
  then protected, then public, so `--privateRegex "^_"` marks underscore-prefixed
  members private and leaves every other member alone.

A member that already declares an accessibility modifier is never rewritten.

# Which TypeScript ts-migrate runs

Every suppression a migration writes comes from what its compiler reports, so
ts-migrate runs the project's own compiler: the `node_modules/typescript` it
finds by searching from `<folder>` upward. The run banner names the copy it
picked.

```
TypeScript 5.7.3 (project: /repo/node_modules/typescript)
```

This matters most under `npx`, which installs the package in a temporary
directory and resolves the `typescript` peer dependency there, picking the
highest version the range allows. A project on TypeScript 5.7 migrated by
TypeScript 6 gets suppressions for errors its own `tsc` never reports, and the
compile check at the end of `ts-migrate-full` fails with TS2578 (unused
`@ts-expect-error`).

Two cases fall back to the compiler installed with ts-migrate. Both are named
in the banner and in a warning:

- the project has no typescript installed (a plain JavaScript project, which
  is why no local install is required)
- the project's typescript is outside the range ts-migrate supports
  (`>=5.0 <7`)

`migrate`, `reignore`, and `check` accept `--typescript <path>` for a compiler
that is not under `node_modules`, or to force a specific one. The path can be
the package directory or any file inside it:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> --typescript ./vendor/typescript
```

`ts-migrate-full` takes the same flag and applies it to both the migrate step
and the compile check, so the two steps cannot disagree about which errors
exist. Without the flag, the check runs whatever compiler the migrate step
resolved.

## When two compilers disagree

TypeScript's checker changes in every minor release, so two compilers a minor
apart are enough for one to report a suppression the other needed as unused
(TS2578). Patch releases do not move diagnostics, so `5.7.2` against `5.7.3`
is treated as the same compiler.

A `--typescript` path that is a minor or more away from the project's own
install is warned about, with both versions and both paths, at the start of
the run and again on the last screen:

```
--typescript names TypeScript 5.5.4 (/repo/vendor/typescript), and this project
has typescript 5.7.3 installed (/repo/node_modules/typescript). ...
```

The interactive `ts-migrate-full` prompt for a custom tsc path is the other way
to end up with two compilers. It is checked before Step 1: if that tsc cannot
report what the migration is about to write, the run says so and stops rather
than spending the whole pipeline on a check it already knows will fail. This
never fires under `--yes`, which sets no custom path.

Reignoring does not fix a skew. `reignore` strips the suppressions and
re-derives them with the migration's compiler, which produces the same set the
check just rejected. Align the two compilers first, then reignore.

# Which ESLint eslint-fix runs

Same principle, same search: the eslint-fix step lints with the project's own
`node_modules/eslint`, found by searching from `<folder>` upward. It reports
the copy it picked once per run.

```
[eslint-fix] ESLint 8.57.1 (project: /repo/node_modules/eslint)
```

Your config was written for your engine. Rule semantics, config resolution,
and severity defaults all move between ESLint majors, and rules are the sharp
edge: ESLint 9 removed `context.getScope()`, `context.getDeclaredVariables()`,
and friends, so a plugin written for ESLint 8 throws on every file a newer
engine hands it. eslint-fix can only report that and give the file back
unfixed, which on one 2,105-file application meant 57 files silently received
no lint fixes at all.

Three cases fall back to the ESLint installed with ts-migrate, all named in
the run line:

- the project has no eslint installed
- the project's eslint is below 8.0
- the project uses a flat config (`eslint.config.*`) and its eslint predates
  8.57, where flat config was still behind `eslint/use-at-your-own-risk`

The second and third also print a warning, because the config and the engine
running it then disagree by a major version.

`migrate` and `reignore` take `--no-projectEslint` to use ts-migrate's own
ESLint regardless:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> --no-projectEslint
```

Flat versus legacy config is detected separately, from the presence of an
`eslint.config.*` file; set `ESLINT_USE_FLAT_CONFIG` to override that.

The search starts at the folder being migrated and walks up, and ESLint is
rooted there too, so `ts-migrate migrate packages/app` run from a repository
root uses `packages/app`'s config, and still finds one at the repository root
when the package has none. The run prints the config file it settled on next
to the engine line:

```
[eslint-fix] ESLint 9.39.4 (project: /repo/node_modules/eslint)
[eslint-fix] flat config: /repo/packages/app/eslint.config.js
```

# Gitignored files

Build output often lives inside the source tree (webpack/SSR bundles, a
`dist` next to `src`, coverage folders). A tsconfig `include` that sweeps it
up makes every command slower and can sink the whole migration: parsing and
type-checking thousands of generated bundles bloats the program until the
process runs out of memory, and the plugins would annotate and suppress
errors in files that get regenerated anyway.

All commands therefore skip gitignored files by default. Git itself is asked
(`git check-ignore`), so nested `.gitignore` files, negations, and global
excludes behave exactly as they do for git, and tracked files are never
skipped even when they match an ignore pattern. In detail:

- `init` writes the gitignored directories present at init time into the
  generated tsconfig's `"exclude"` (together with TypeScript's default
  excludes, which an explicit `exclude` would otherwise replace), so the
  project's own `tsc` skips them too.
- `rename` leaves gitignored JS/JSX files unrenamed.
- `migrate` and `reignore` keep gitignored files out of the program: they are
  neither parsed, type-checked, migrated, nor suppressed. A gitignored file
  that a migrated file imports still enters the program for type resolution,
  and the `.d.ts` files your tsconfig includes always stay in it (gitignored
  codegen output often declares ambient types the rest of the project needs).
- `report` and `check` leave gitignored files uncounted.

`rename`, `migrate`, and `reignore` log what they skipped, and their
`--jsonSummary` reports the count as `skippedGitignoredFiles`. Filtering
disables itself when the target folder is not inside a git repository or is
itself gitignored — a scratch copy of a project inside an ignored directory
migrates normally.

Pass `--no-gitignore` to `rename`, `migrate`, `reignore`, `report`, or
`check` to include ignored files anyway. If your existing tsconfig `include`
matches gitignored build output, add it to `exclude` as well: ts-migrate
skips it either way, but your own `tsc` (including the compile check at the
end of `ts-migrate-full`) still type-checks it otherwise.

# Build system files

A JavaScript project's build tooling runs under plain Node before any
compile step exists: webpack loads `webpack.config.js` with `require`, npm
scripts run `node scripts/build.js`, Babel reads `babel.config.js`, test
runners load `jest.config.js` or `karma.conf.js`. Renaming those files to
`.ts` kills the build at its entry point, and no later step repairs it:
webpack cannot compile the very config it needs in order to start compiling.

`rename`, `migrate`, and `reignore` therefore keep build system files in
JavaScript by default, and `init` writes the detected files into the
generated `"exclude"` so the project's own `tsc` and editors skip them too.
Detection, in order of confidence:

- Known config names next to a package.json: `*.config.js`, `*.conf.js`,
  `gulpfile.js`, `Gruntfile.js`, and the `.*rc.js` family.
- Paths a package.json script runs with `node`, as in
  `"build": "node scripts/build.js"`. (`main` and `bin` are not evidence:
  after a migration those should point at build output.)
- Files the detected ones reach through relative `require()`/`import`
  literals, so `webpack.config.js` keeps `config/paths.js` with it. Dynamic
  requires are not followed; use the tsconfig `exclude` for those.

Every extension the compiler reads as JavaScript counts, so
`eslint.config.mjs`, `postcss.config.cjs` and `node scripts/build.mjs` are
detected the same way `.js` files are, in `rename` and in the `"exclude"`
`init` writes.

Each run logs every kept file with its evidence, and `--jsonSummary` reports
them as `skippedBootstrapFiles` with path and reason. A kept file never enters
the rename mapping, which is also what protects the package.json references to
it: `"build": "node scripts/build.js"` still says `.js` when the run finishes,
and a `bin` entry pointing at a file some script runs with `node` stays valid
and is never reported, because that file was never renamed in the first place.
Two overrides exist: `--no-bootstrap` renames them anyway (use it when the
project already loads TypeScript configs through ts-node or tsx), and a
tsconfig `exclude` entry keeps a specific file out of every run. In `migrate`
and `reignore` the flag only decides whether the files are loaded into the
program: neither command edits JavaScript, so a build system file left as
`.js` is never rewritten.

Two safeguards bound the detection. A detected file whose require tree spans
more than half the project (and more than eight files) is treated as an
application entry, not build tooling: `"start": "node server.js"` names the
application itself, so only `server.js` stays JavaScript and its require
tree migrates normally (point the script at your build output afterwards).
And when application code imports a kept file, the file still stays
JavaScript but the run warns, naming both sides; enable `allowJs` or split
the shared module if the TypeScript side needs it.

# .mjs and .cjs files

Node projects mix extensions: a `"type": "module"` package carries `.cjs`
shims, and a CommonJS package carries `.mjs` scripts. `rename` converts
`.mjs` to `.mts` and `.cjs` to `.cts`, which keep the module system the
original extension pinned and emit back to `.mjs` and `.cjs`. Relative
imports naming those files therefore stay correct and `migrate` leaves them
untouched.

The same pinning decides the imports written inside a renamed file. A `.cts`
file resolves its own relative imports the CommonJS way, so `migrate` drops
the extension there (`./foo`) even inside a `"type": "module"` package, where
a `.ts` or `.mts` file in the same folder keeps `./foo.js`.

Two kinds of file keep the extension they have:

- Configs a build tool loads by exact name, such as `postcss.config.cjs`,
  `eslint.config.mjs`, and the `.*rc.cjs` family. The tool looks for that
  filename and would not find a `.cts` or `.mts` one. This holds even under
  `--no-bootstrap`, which renames build system files that have a working
  `.ts` spelling.
- Files holding JSX. TypeScript has no JSX-enabled counterpart to `.mts` or
  `.cts` (there is no `.mtsx`), so the rename would turn valid JSX into
  syntax errors.

Both are logged with the file and the reason. To migrate one anyway, give it
a `.js` extension first and set the module system through the enclosing
package's `"type"`.

# Using ts-migrate with AI agents

The package ships a playbook written for AI coding agents (Claude Code, Cursor,
Codex, ...) covering non-interactive usage, the recommended migration workflow,
and the failure modes agents tend to hit. Print it with:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate agents
```

The same document is published as [AGENTS.md](./AGENTS.md) in this package. The
essentials: run the full pipeline non-interactively with

```sh
npx -p @obiemunoz/ts-migrate ts-migrate-full <folder> --yes --no-commit
```

where `--yes` skips the confirmation prompts and `--no-commit` leaves the
changes in the working tree instead of creating git commits.

To point your repository's agents at the tool, paste this into your project's
`CLAUDE.md` / `AGENTS.md`:

```markdown
## Migrating JavaScript to TypeScript

Use `@obiemunoz/ts-migrate` — a bare `npx ts-migrate` would fetch the
unmaintained upstream package. First print and follow the tool's playbook:

    npx -p @obiemunoz/ts-migrate ts-migrate agents

Then run the migration non-interactively:

    npx -p @obiemunoz/ts-migrate ts-migrate-full <folder> --yes --no-commit
```

# Reignore

If you are in a situation where you made some big project-wide changes, update of the common library like TypeScript, React or Redux or improve types for the large codebase. As a result of these operations, you might get quite a few TypeScript compilation errors. There are two ways to proceed:

 1) Fix all the errors (ideal, but time-consuming).
 2) Make the project compilable and fix errors gradually.

For the second option we created a re-ignore script, which will fully automate this step. It will add `any` or `@ts-expect-error` (`@ts-ignores`) comments for all problematic places and will make your project compilable.

Usage: `npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>`.

If only part of the project was migrated with `--sources`, pass the same flags
here so reignore stays inside that subset instead of churning suppressions in
directories the migration never touched.

# Type definition recommendations

Many of the errors ts-migrate suppresses aren't really problems with your code —
they are missing environment types. Without `@types/node`, every `require`,
`process`, and `__dirname` becomes a suppressed "Cannot find name" error; without
your test runner's types, so does every `describe` and `it`.

`ts-migrate init` says what it can before anything runs. It already enumerates
the installed `@types` packages to pin the tsconfig `types` array, so crossing
those against the dependencies your package.json declares names the obvious gaps
while installing them still saves the suppressions:

```
Type packages worth installing before the migration:
  @types/node is not installed: node globals and imports of builtin modules have no types without it.
  @types/jest is not installed: jest is a dependency here and its test globals have no types without it.
  Install: pnpm add -D @types/node @types/jest
  Installing them first keeps this migration from suppressing the errors they would fix.
```

That is advice, not a gate: `init` writes the config and exits 0 either way. It
is also everything package.json alone can prove, so it stays narrow. Only
`@types/node` and the `@types` for a declared test runner are named, a package
your package.json already declares is left to the install, and nothing at all is
named in a project whose dependencies are not installed, where every package
would look missing. Everything else waits for the compiler.

`migrate` and `reignore` print the same block with their opening banner, before
the pipeline they can spend hours in. `init` only writes a config when the
folder has none, so a project that is already part TypeScript, or any re-run,
would otherwise hear this for the first time at the end of the run that
suppressed those errors. Pass `--no-typesPreflight` to skip it;
`ts-migrate-full` passes that flag to its migrate step whenever Step 1 wrote the
tsconfig and already said it. The `"types"` array reminder follows the tsconfig
the run reads, not the one `init` would have written.

They also detect this from the compiler diagnostics themselves and end the run
with a report (`ts-migrate-full` holds it back until the very end, after the
compile check):

```
Type definition recommendations:
  Missing type definitions:
    @types/node — 6 errors in 2 files (require, __dirname, module)
    @types/jest — 4 errors in 1 file (describe, beforeEach, it)
  Untyped imports (@types packages may exist for them):
    @types/lodash — 1 error in 1 file (import 'lodash')
  Install: pnpm add -D @types/node @types/jest
  Then try: pnpm add -D @types/lodash
  After installing type definitions, rerun: npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>
```

Installing the packages and re-running `reignore` deletes every suppression they
resolve. The report only recommends what the diagnostics prove is missing:

- A package that is installed and working is never mentioned.
- A package that is installed but hidden by the tsconfig `types` array (or a
  `typeRoots` override) gets a config suggestion instead of an install.
- When the tsconfig pins a `types` array (the config `ts-migrate init` writes
  pins whichever `@types` packages it finds installed, plus `vite/client` on a
  Vite project), the report reminds you to add newly installed packages to that
  array as well.
- Installed `@types` packages whose major version lags the library (or Node
  version) they describe are listed as possibly outdated.
- `@types` packages made redundant by a library that now ships its own types are
  flagged for removal.
- The test-runner suggestion follows your package.json: jest, mocha, and jasmine
  map to their `@types` packages; vitest projects are pointed at
  `"types": ["vitest/globals"]` instead.
- The install command matches your project's package manager: npm, yarn, pnpm,
  and bun are recognized by the `packageManager` field in your package.json, and
  by their lockfiles when the field is absent. A field that disagrees with the
  lockfile wins, and the report says which lockfile it passed over.
- A directory holding more than one lockfile, as a repository midway through
  switching managers does, is settled by the `packageManager` field, then by a
  `pnpm-workspace.yaml`, and failing both by whichever lockfile was modified
  last. The report names the lockfiles that lost a tie broken that way.

The `Then try` line is separate because `@types` packages derived from untyped
imports (rather than well-known globals) aren't guaranteed to exist on npm.

## Packages with no type definitions available

Plenty of small packages have no `@types` entry on DefinitelyTyped, which leaves
the `Then try` line as a dead end: nothing to install, and a suppression at every
single import of the package.

For those, `migrate` and `reignore` write one declaration file instead:

```ts
// types/ts-migrate-modules.d.ts
// Generated by ts-migrate. Modules whose packages ship no type definitions, declared
// here so their imports are `any` instead of an error at every import site.
// Install the types when a package has them and delete its line; ts-migrate
// drops entries whose types it can resolve the next time it runs.
declare module 'some-untyped-lib';
```

The imports keep the type they already had (a package with no declarations is
implicitly `any` either way), but they stay ordinary checkable imports rather
than turning into N `@ts-expect-error` comments. The file is generated before the
suppression pass, so the errors it resolves are never written in the first place.

- Only packages the compiler actually reported as untyped are declared, so a
  package that has types — bundled or from an installed `@types` — is never
  shadowed by a declaration.
- The file is managed across runs: entries from earlier runs are kept, and any
  whose types ts-migrate can now resolve are dropped, so installing the real
  `@types` package is all it takes to retire an entry.
- A file at that path that ts-migrate did not write is left alone.
- `--no-declareUntypedModules` turns this off and goes back to suppressing each
  import.

On a project migrated before this existed, `reignore` clears the suppressions
retroactively: it strips them, sees the errors again, and declares the packages
instead of re-adding the comments.

Make sure your tsconfig includes the file. The config `ts-migrate init` writes
does; if yours restricts `include` to a source directory, add
`types/ts-migrate-modules.d.ts` to `include` or `files` — ts-migrate warns when
the file it generated is not matched.

## Asset imports on a webpack project

A bundled app imports assets through its loaders: `import logo from './logo.png'`,
`import './App.css'`. TypeScript has no loaders, so a bound import is a TS2307 at
every site and a side-effect import is a TS2882 on TypeScript 6 (TypeScript 5
lets that one through silently, which is its own surprise on upgrade). Vite
projects are covered by `vite/client`, which `init` pins. webpack has no
equivalent: `@types/webpack-env` declares the webpack globals and contains no
`declare module` statements at all.

So on a webpack project (including Create React App, detected through
`react-scripts`) `init` writes a second file:

```ts
// types/ts-migrate-assets.d.ts
declare module '*.css' {}

declare module '*.png' {
  const src: string;
  export default src;
}
```

A wrong declaration is worse than a suppression, because the suppression is
visibly unfinished while a wrong shape type-checks and misleads. So the file is
deliberately narrow:

- Only extensions the project actually imports are declared. An extension nothing
  imports would be noise to read past.
- Images, fonts and media (`*.png`, `*.woff2`, `*.mp4`, and the rest) get a
  `string` default export. Every rule that handles them, file-loader through
  webpack 5 asset modules, produces a URL or a data URL.
- An extension imported only for its side effects gets a module with no exports.
  Nothing observes what the loader exported, so nothing can be wrong.
- `*.svg` gets the `string` default export only when no svgr package is installed.
  With `@svgr/webpack` (or a sibling) the default may be a React component
  instead, and only the webpack config settles which.
- An extension imported by name (`import { ReactComponent } from './logo.svg'`)
  and a style sheet bound to a name (CSS modules) are left undeclared. Only the
  loader, and often only its version, knows what those export.

`init` names every extension it skipped and why. Declare those yourself, in a
file of your own. A file already at `types/ts-migrate-assets.d.ts` that
ts-migrate did not write is left alone, and so is the whole step on a project
whose tsconfig already exists, since `init` never touches one.

## Absolute imports on a bundled project

A bundled app usually imports its own modules by name rather than by relative
path: `import { KeyCodes } from 'shared/constants/keyCodes'`, `import App from
'@/App'`. webpack resolves those through `resolve.modules` and `resolve.alias`,
and TypeScript resolves neither, so each one is a TS2307 that the migration
turns into a suppression. On one measured project (`oldboyxx/jira_clone`, 149
files, hand-rolled webpack 4) that was 180 of 609 suppressions, 30% of the run.

`init` writes the tsconfig equivalent, `paths`, from two sources:

- `jsconfig.json`, if the project has one. It is the project stating what its
  absolute imports mean, so its `baseUrl` and `paths` are taken as they are.
  This is also what a Create React App project has, since `react-scripts` keeps
  its webpack config to itself.
- `webpack.config.*` at the project root, read as text. Each `resolve.modules`
  root becomes a `"*"` pattern and each `resolve.alias` entry becomes a `paths`
  entry.

```jsonc
"paths": {
  "*": ["./src/*"],
  "@": ["./client/app"],
  "@/*": ["./client/app/*"]
}
```

It is `paths` and never `baseUrl`, including where the source was a `baseUrl`:
TypeScript 6 reports that option as deprecated (TS5101, an error unless the
config also sets `ignoreDeprecations`) and TypeScript 7 drops it. A `"*"`
pattern does the same job on every supported line, and a specifier no pattern
answers still falls through to `node_modules` either way.

**The config is never executed.** Running a project's build config to read it
would run arbitrary code from the project being migrated. It is parsed instead,
and only the forms a resolve entry is actually written in are understood: string
literals, `__dirname`, `path.join`/`path.resolve` over those, template literals,
and `const` bindings of the same. `webpack.config.js` and
`webpack.config.prod.js` are both read, and so is a `resolve` built up before
the config is exported.

That leaves plenty unreadable, and a wrong `paths` entry is worse than none:
the suppression it replaces is visibly unfinished, while an entry pointing at
the wrong directory resolves to the wrong module and type-checks. So an entry is
written only when it cannot be wrong, and everything else is named in the log
rather than guessed at:

```
Read "paths" for * from webpack.config.js, so this project's absolute imports
resolve instead of collecting a suppression.
Leaving resolve.alias "extensions" out of the generated tsconfig: its target is
computed when the config runs.
```

An alias is left out when its target is computed at build time (`process.env`, a
function argument, a required helper), when the target does not exist on disk,
when it points outside the migration root, or when two configs disagree about
it. A project with no `jsconfig.json` and no readable `resolve` gets exactly the
tsconfig it got before, byte for byte.

Aliases are not rewritten into relative imports. They are the project's own
convention and it keeps them.

# Measuring type debt

A migration that ends with `tsc` exiting 0 says nothing about how much of the
project ended up suppressed or typed as `any`: a run that turned every
parameter into `$TSFixMe` passes the same bar as one that inferred everything.
Two commands measure exactly that. Counts come from per-file ASTs, so strings
and JSX text that merely contain the directive words are not counted, and no
type-checker program is needed.

```sh
npx -p @obiemunoz/ts-migrate ts-migrate report <folder>
```

prints totals and per-file counts (the 10 worst files, plus how many more
have debt) of:

- `@ts-expect-error` and `@ts-ignore` comments, including a breakdown of the
  suppressed error codes ts-migrate embeds in them (`TS(2304)` and so on);
- any-alias annotations (`$TSFixMe` and friends, discovered from the aliases
  your project's `.d.ts` files actually declare rather than hardcoded);
- explicit `any` annotations.

`--json` prints the same data for machine consumption, with every file
listed. `migrate` and `reignore` end their runs with the one-paragraph
totals of this report.

```sh
npx -p @obiemunoz/ts-migrate ts-migrate check <folder>
```

is the enforcement mode, meant for CI. The first run writes a per-file
baseline to `.ts-migrate-baseline.json` in `<folder>`; commit it. Later runs
exit nonzero if any per-file count exceeds the baseline and lower the
baseline automatically when counts improve, so the debt can only ratchet
down. Accept an intentional increase with `--update-baseline`; relocate the
file with `--baselineFile <path>`.

# Previewing a run (`--dry-run`)

`rename`, `migrate`, and `reignore` accept `--dry-run` to show what a run
would touch before anything hits disk:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate rename <folder> --dry-run
```

```sh
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> --dry-run
```

`rename --dry-run` prints the full old-to-new mapping, which also surfaces
the `.ts` vs `.tsx` decision made for each `.js` file, together with the
package.json references a real run would rewrite. `migrate` and
`reignore` print each file a real run would update, with the suppression and
`any` counts it would then contain:

```
Dry run: 2 file(s) would be updated in frontend/foo (nothing was written):
  src/util.ts (2 any-alias)
  src/widget.tsx (2 @ts-expect-error)
For full diffs, run without --dry-run on a clean git tree and use git diff.
```

Every plugin pass still executes against the in-memory project; only the
final writes are skipped. A dry run therefore takes as long as a real run,
and its report matches the real outcome exactly (with `--aliases`, the
declaration file the real run would generate is modeled in memory too).
Per-file diffs are deliberately not printed: at migration scale they are
enormous, and git shows them better after a real run.

`--dry-run` combines with `--jsonSummary` (below) for a machine-readable
preview; the summary file is still written, with `"dryRun": true`.
`ts-migrate-full` rejects the flag, since each of its steps builds on the
previous step's writes; preview with the individual commands instead.

# Machine-readable run summaries

A script or agent driving the CLI otherwise has to scrape the progress log to
learn what a run did. The `rename`, `migrate`, and `reignore` commands accept
a `--jsonSummary <file>` flag that writes a JSON summary of the run to a file
(a file rather than stdout, which stays reserved for the progress log):

```sh
npx -p @obiemunoz/ts-migrate ts-migrate migrate <folder> --jsonSummary migrate-summary.json
```

```json
{
  "command": "migrate",
  "tsMigrateVersion": "<the installed version>",
  "rootDir": "/repo/frontend/foo",
  "exitCode": 0,
  "dryRun": false,
  "changedFiles": ["src/a.ts", "src/b.ts"],
  "generatedFiles": ["types/ts-migrate-modules.d.ts"],
  "nonMigratedFilesWithSyntaxErrors": [],
  "plugins": [
    { "name": "infer-types", "changedFileCount": 2 },
    { "name": "ts-ignore", "changedFileCount": 1 }
  ],
  "pluginFailures": [
    {
      "plugin": "eslint-fix",
      "reason": "context.getScope is not a function",
      "ruleId": "@typescript-eslint/no-unused-vars",
      "fileCount": 2,
      "files": ["src/a.ts", "src/b.ts"]
    }
  ],
  "changedFilesTypeDebt": {
    "aliasNames": [],
    "totals": { "tsExpectError": 3, "tsIgnore": 0, "anyAlias": 0, "any": 2, "codes": { "TS2304": 3 } }
  },
  "skippedGitignoredFiles": 0,
  "skippedBootstrapFiles": [
    { "file": "webpack.config.js", "reason": "config file next to a package.json" }
  ]
}
```

(`plugins` lists every step of the pipeline; the example is shortened.) Paths
are relative to `<folder>`. `reignore` writes the same shape; `rename` writes
`renamedFiles` as `{"from": "src/a.js", "to": "src/a.ts"}` pairs instead of
the migrate fields, plus `packageJsonRewrites` (the script paths and test
globs it repointed, as `{"file", "key", "from", "to"}`) and
`packageJsonNotices` (the entry point fields that still name a renamed file
and were left for you, as `{"file", "key", "value", "target"}`).
`skippedGitignoredFiles` counts the files the run left untouched because git
ignores them (always 0 with `--no-gitignore`).
`skippedBootstrapFiles` lists the build system files the run kept as
JavaScript, each with its detection evidence (always empty with
`--no-bootstrap`). `generatedFiles` lists the declaration files the run wrote
itself, which are new files rather than changes to existing ones.
`pluginFailures` lists the files a plugin could not process, grouped by cause:
a lint config whose rules throw leaves files unchanged without failing the
run, so a run that exits 0 can still have left files untouched. It is empty
when every plugin processed every file. `changedFilesTypeDebt` counts only the files this run
changed, so a scoped or incremental run reports its own debt; the `report`
command measures the whole project. `dryRun` is true when the run was a
`--dry-run` preview: the summary then describes what a real run would have
changed, scanned from the would-be contents rather than the disk.

The file is written whenever the command runs to completion, so its
`exitCode` field matches the process exit code. No file plus a nonzero exit
means the command failed before running (bad flags, missing tsconfig.json).
If the summary file itself cannot be written, the command exits nonzero.
`ts-migrate-full` forwards extra flags to both its rename and migrate steps,
so a `--jsonSummary` passed there ends up holding the migrate summary; run
the commands individually when you need both.

# Using `--sources` for partial migrations

There are times in which migrating an entire project is too large a change. The `--sources` flag (or `-s` for short) allows you to run `ts-migrate` on a subset of your project by providing a set of sources to override the defaults specified in your tsconfig. `--sources` takes a relative path from the root of your project. It accepts globs, but remember to wrap any globs with quotes.

```sh
# Run everything on a sub-directory
npx -p @obiemunoz/ts-migrate ts-migrate-full /path/to/your/project --sources "some/components/**/*"

# Or run just one sub-command
npx -p @obiemunoz/ts-migrate ts-migrate rename /path/to/your/project -s "some/components/**/*"
```

When `--sources` is used, the tsconfig `include` no longer decides what gets migrated, but the ambient declaration files it matches (`vite-env.d.ts`, `react-app-env.d.ts`, a custom `globals.d.ts`) are kept in the program so the globals they declare still resolve instead of turning into bogus suppressions. The run logs which files it retained. Pass `--no-ambientSources` to opt out and build the program from exactly the sources you list.

The directories you have not converted yet are still plain JavaScript, and the generated tsconfig sets `allowJs` so imports reaching into them resolve to the types TypeScript infers from the source instead of erroring and collecting a suppression each. Those suppressions would be pure churn: the next directory's migration removes the file they point at. `checkJs` stays off, and `migrate` never edits `.js`, `.jsx`, `.mjs` or `.cjs`, so nothing on the JavaScript side is type-checked or rewritten before `rename` reaches it. If your project has a hand-written tsconfig, add `"allowJs": true` to get the same behavior.

`@types` packages are loaded through the tsconfig `types` array regardless of sources. The one case that still needs a manual re-include is a package that ships unimported global declarations outside `@types`:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate-full /path/to/your/project \
  --sources "some/components/**/*" \
  --sources "node_modules/some-package/globals.d.ts"
```

The same scoping applies to a follow-up `reignore` on a repo migrated one
directory at a time. Pass the same globs so it only strips and re-adds
suppressions in the directories you have migrated so far:

```sh
npx -p @obiemunoz/ts-migrate ts-migrate reignore /path/to/your/project \
  --sources "some/components/**/*"
```

# After the migration

The tool's contract is narrow on purpose: when it finishes, `tsc` compiles your project with zero errors. Nothing gives the project a way to *produce* JavaScript again, standalone runner configs (`jest.config.js`, `.mocharc.yml`) are left alone, and your lint setup still expects `.js`. When I ran the full pipeline against a plain CommonJS library as a smoke test, the migration itself was clean, and the test suite still wouldn't run until the project plumbing caught up.

`rename` does handle the package.json references that follow mechanically from the rename, so don't redo these by hand: the paths and globs in `scripts`, and in the `jest` block (`testMatch`, `collectCoverageFrom`, `setupFiles`, `setupFilesAfterEnv`, `globalSetup`, `globalTeardown`) and `mocha` block (`spec`, `require`). A mocha glob like `test/*.js` is rewritten to `test/*.ts`, or widened to `test/*.{js,ts}` when some of the files it matched are still JavaScript. Only references that resolve to a file the run actually renamed change, so `"build": "node scripts/build.js"` keeps its `.js` path. Every rewrite is logged, and edits are text splices, so your formatting and key order survive. Expect to do the rest afterwards:

1. **Give the project a way to produce JS again.** Add a build step (`tsc`) or a TS-aware runner (ts-node, tsx), then repoint the entry point fields `rename` listed for you — `main`, `module`, `browser`, `bin`, `exports`, `types`, `files` — at build output that actually exists. Those are deliberately reported rather than rewritten: they address your package from the outside, so pointing `main` at `src/index.ts` would leave it unloadable rather than merely stale.
2. **Teach ESLint about TypeScript.** Until the `@typescript-eslint` parser and plugin are in place, `eslint .` will either fail to parse `.ts` files or find no files at all. The eslint-fix step of the migration uses your project's own ESLint, so it skips unparseable files too until this is done.
3. **Install missing `@types` packages, then re-run reignore.** `npm i -D @types/node` plus the types for your test runner, then `npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>` to drop the suppression comments you no longer need. If the migration was scoped with `--sources`, pass the same flags to reignore so it only touches that subset.

Honestly, item 3 is worth doing before you migrate at all. With the environment types in place, globals like `require` and `describe` resolve to real types instead of a wall of suppressed "Cannot find name" errors.

# FAQ

> Why fork airbnb/ts-migrate?

Upstream has been unmaintained since 2022 and tops out at TypeScript 4. I needed it on a current compiler, and it turned out that keeping AST-based codemods working across compiler major versions is a real job: TypeScript is willing to renumber internal AST constants between releases, which can make a codemod silently misread your code rather than fail loudly. This fork runs on TypeScript 5 and 6, has a canary test for exactly that class of breakage, and gets exercised against deliberately weird JavaScript so transform bugs get caught with regression tests instead of in your codebase.

> Which TypeScript versions are supported?

5.x and 6.x (the peer range is `>=5.0 <7`). Support for the TypeScript 7 native port is in progress; the compiler API is moving around enough that I'd rather land it properly than rush it.

> Why does the generated tsconfig pin a `types` array?

TypeScript 6 stopped loading `node_modules/@types` automatically (bulk inclusion now requires `types: ["*"]`, which TypeScript 5 rejects as a package name). Naming the installed packages is the only form both majors read identically. Without it, the TypeScript that ts-migrate runs and the `tsc` your project runs can disagree about whether globals like `require` and `describe` exist — one adds suppressions the other reports as unused (TS2578). The trade-off: after installing a new `@types` package, add it to the array. The array is not only `@types` packages — a Vite project also gets `vite/client`, so it can end up with a pinned array with no `@types` package installed at all.

> Why does the generated tsconfig say `"moduleResolution": "bundler"`?

Because on that project the bundler resolves the imports, not Node. `init` writes `"module": "esnext"` with `"moduleResolution": "bundler"` when it finds Vite or webpack in `dependencies`/`devDependencies`, `react-scripts` for a Create React App project, or a `vite.config.*`/`webpack.config.*` file in the folder. Both of the settings it would otherwise pick break a bundled app, in different ways: under `commonjs`, every `import.meta.env` is a TS1343, and under the `nodenext` that a `"type": "module"` package gets, extensionless relative imports stop resolving (TS2835 on `import './util'`). A Vite project also gets `vite/client` in its `types` array, which is what declares `import.meta.env` and asset imports like `*.svg` and `*.css`; on webpack, install `@types/webpack-env` so `require.context` and `module.hot` type, which `init` tells you when it is missing, and `init` writes the asset declarations itself ([above](#asset-imports-on-a-webpack-project)).

Detection is deliberately blunt, so a Node library that keeps webpack in devDependencies only to build a UMD bundle gets the bundler settings too. Setting those two fields back by hand is a one-time fix — `init` never touches a tsconfig that already exists.

> Can it magically figure out all the types?

No, and I feel like anyone who tells you otherwise is selling something. The infer-types step does real inference where the language service can prove a type from how a value is used (and from propTypes on React components). Everything it can't prove falls back to `any` with a suppression comment. I'm very much of the mindset that a project that compiles today and gets better types incrementally beats a migration that stalls at 80% trying to be perfect.

> I see lots of `@ts-expect-error` and `any`. Is that expected?

Yes. The output is a starting point, not a finish line. That being said, two things shrink the wall of comments considerably. First, install your `@types` packages before migrating: on one plain CommonJS library I tested, roughly 90 of the 101 suppressions were just missing environment types (`require`, `describe`, and friends), not real type problems. Second, whenever you improve types or add `@types` packages later, re-run `npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>` to strip the suppressions that are no longer needed (if your tsconfig pins a `types` array — the generated one does — add the new package names there first).

> What is `$TSFixMe`?

An Airbnb convention this fork inherited: an alias for `any` (`type $TSFixMe = any;`, plus `$TSFixMeFunction` for function signatures). It made the follow-up work easy to grep for in their codebase. It's opt-in here with `--aliases tsfixme`; the default is plain `any`. When the flag is on, `migrate` writes the global declarations to a `ts-migrate-aliases.d.ts` in the migrated folder, unless your project already declares them somewhere the tsconfig includes.

> Does it work with ESLint 9 and flat configs?

Yes, and with ESLint 8 and `.eslintrc` too. The eslint-fix step loads your project's own ESLint installation and auto-detects flat versus legacy config (set `ESLINT_USE_FLAT_CONFIG` to override the detection); see [Which ESLint eslint-fix runs](#which-eslint-eslint-fix-runs) for the fallbacks and `--no-projectEslint`. One caveat: if your ESLint can't parse TypeScript yet, there is nothing for it to fix. It warns and moves on, which is one more reason to get `@typescript-eslint` set up early.

> It's slow on my big repo.

Type inference is the expensive part, and it's several times faster now than it was when I forked the project. On a huge codebase you still have knobs: `--no-inferTypes` skips inference entirely, and `--maxStablePasses` caps how many times the repeating plugins re-run while files keep changing. Each plugin pass also shows a processed/total counter naming the file it is on (occasional plain lines when output is not a terminal), so you can see how far into the pass it is and which file it is working through. The counter only moves when a file starts or finishes, so a file that is taking a long time leaves it sitting still; when that file does finish, any file over 30 seconds gets a line of its own naming it and how long it took. Between passes the run reports how many files the pass changed, which is what tells a group that is settling from one that is going in circles.

> Is ts-migrate React-specific?

No. The default pipeline includes React-focused plugins because that's the tool's heritage, but they no-op quickly on anything else. Running against a plain CommonJS i18n library, every React plugin finished in about a millisecond and changed nothing, and the migration came out correct.

> The final compile check failed on files I didn't migrate.

Suppression comments can only fix type errors in the migrated files. If the project references a declaration file that doesn't parse — hand-written or produced by a code generator — every `tsc` run fails on it regardless of what the migration did. The migrate step lists such files up front (look for "syntax errors ts-migrate cannot fix" in the log): fix or regenerate them, or exclude them in tsconfig.json, then re-run the compile check. Re-running the migration will not change them.

> ts-migrate broke my code!

It happens; JavaScript has an effectively infinite supply of weirdness. Everything found so far, from suppression comments corrupting template strings to transforms racing each other, has a fix and a regression test. If you hit something, please file an [issue](https://github.com/ObieMunoz/ts-migrate/issues/new) with the smallest input file you can manage.

> How was it used originally?

Airbnb built it and migrated the bulk of their codebase with it, including applications north of 50,000 lines converted in a day. This fork keeps that machinery alive on modern TypeScript.

# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
