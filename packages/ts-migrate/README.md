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
  ts-migrate init <folder>                Initialize tsconfig.json file in <folder>
  ts-migrate init:extended <folder>       Initialize tsconfig.json file in <folder>
  ts-migrate rename [options] <folder>    Rename files in folder from JS/JSX to TS/TSX
  ts-migrate migrate [options] <folder>   Fix TypeScript errors, using codemods
  ts-migrate reignore [options] <folder>  Re-run ts-ignore on a project
  ts-migrate agents                       Print usage instructions for AI coding agents (non-interactive playbook)

Options:
  -h, --help     Show help  [boolean]
  -v, --version  Show version number  [boolean]

Examples:
  ts-migrate --help                             Show help
  ts-migrate migrate --help                     Show help for the migrate command
  ts-migrate init frontend/foo                  Create tsconfig.json file at frontend/foo/tsconfig.json
  ts-migrate init:extended frontend/foo         Create extended from the base tsconfig.json file at frontend/foo/tsconfig.json
  ts-migrate rename frontend/foo                Rename files in frontend/foo from JS/JSX to TS/TSX
  ts-migrate rename frontend/foo --s "bar/baz"  Rename files in frontend/foo/bar/baz from JS/JSX to TS/TSX
  ts-migrate agents                             Print the agent playbook

AI coding agents: run `npx -p @obiemunoz/ts-migrate ts-migrate agents` for the full non-interactive usage playbook.
```

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
`.ts`/`.tsx` file (the extension is dropped, or kept as `.js` inside an ESM
package). Imports whose target still exists on disk are left alone.

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

`migrate` and `reignore` detect this from the compiler diagnostics themselves and
end the run with a report (`ts-migrate-full` holds it back until the very end,
after the compile check):

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
  pins whichever `@types` packages it finds installed), the report reminds you
  to add newly installed packages to that array as well.
- Installed `@types` packages whose major version lags the library (or Node
  version) they describe are listed as possibly outdated.
- `@types` packages made redundant by a library that now ships its own types are
  flagged for removal.
- The test-runner suggestion follows your package.json: jest, mocha, and jasmine
  map to their `@types` packages; vitest projects are pointed at
  `"types": ["vitest/globals"]` instead.
- The install command matches your project's package manager: npm, yarn, pnpm,
  and bun are recognized by their lockfiles.

The `Then try` line is separate because `@types` packages derived from untyped
imports (rather than well-known globals) aren't guaranteed to exist on npm.

# Using `--sources` for partial migrations

There are times in which migrating an entire project is too large a change. The `--sources` flag (or `-s` for short) allows you to run `ts-migrate` on a subset of your project by providing a set of sources to override the defaults specified in your tsconfig. `--sources` takes a relative path from the root of your project. It accepts globs, but remember to wrap any globs with quotes.

```sh
# Run everything on a sub-directory
npx -p @obiemunoz/ts-migrate ts-migrate-full /path/to/your/project --sources "some/components/**/*"

# Or run just one sub-command
npx -p @obiemunoz/ts-migrate ts-migrate rename /path/to/your/project -s "some/components/**/*"
```

When `--sources` is used, the tsconfig `include` no longer decides what gets migrated, but the ambient declaration files it matches (`vite-env.d.ts`, `react-app-env.d.ts`, a custom `globals.d.ts`) are kept in the program so the globals they declare still resolve instead of turning into bogus suppressions. The run logs which files it retained. Pass `--no-ambientSources` to opt out and build the program from exactly the sources you list.

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

The tool's contract is narrow on purpose: when it finishes, `tsc` compiles your project with zero errors. It does not touch your package.json scripts, your test runner config, or your lint setup, and those still point at a world of `.js` files that no longer exists. When I ran the full pipeline against a plain CommonJS library as a smoke test, the migration itself was clean, and the test suite still wouldn't run until the project plumbing caught up. Expect to do these afterwards:

1. **Give the project a way to produce JS again.** Add a build step (`tsc`) or a TS-aware runner (ts-node, tsx). If package.json `main` pointed at a renamed file, point it at build output that actually exists.
2. **Update scripts that reference old `.js` paths.** A mocha glob like `test/*.js` now matches nothing. Same idea for jest patterns and docs generators.
3. **Teach ESLint about TypeScript.** Until the `@typescript-eslint` parser and plugin are in place, `eslint .` will either fail to parse `.ts` files or find no files at all. The eslint-fix step of the migration uses your project's own ESLint, so it skips unparseable files too until this is done.
4. **Install missing `@types` packages, then re-run reignore.** `npm i -D @types/node` plus the types for your test runner, then `npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>` to drop the suppression comments you no longer need. If the migration was scoped with `--sources`, pass the same flags to reignore so it only touches that subset.

Honestly, item 4 is worth doing before you migrate at all. With the environment types in place, globals like `require` and `describe` resolve to real types instead of a wall of suppressed "Cannot find name" errors.

# FAQ

> Why fork airbnb/ts-migrate?

Upstream has been unmaintained since 2022 and tops out at TypeScript 4. I needed it on a current compiler, and it turned out that keeping AST-based codemods working across compiler major versions is a real job: TypeScript is willing to renumber internal AST constants between releases, which can make a codemod silently misread your code rather than fail loudly. This fork runs on TypeScript 5 and 6, has a canary test for exactly that class of breakage, and gets exercised against deliberately weird JavaScript so transform bugs get caught with regression tests instead of in your codebase.

> Which TypeScript versions are supported?

5.x and 6.x (the peer range is `>=5.0 <7`). Support for the TypeScript 7 native port is in progress; the compiler API is moving around enough that I'd rather land it properly than rush it.

> Why does the generated tsconfig pin a `types` array?

TypeScript 6 stopped loading `node_modules/@types` automatically (bulk inclusion now requires `types: ["*"]`, which TypeScript 5 rejects as a package name). Naming the installed packages is the only form both majors read identically. Without it, the TypeScript that ts-migrate runs and the `tsc` your project runs can disagree about whether globals like `require` and `describe` exist — one adds suppressions the other reports as unused (TS2578). The trade-off: after installing a new `@types` package, add it to the array.

> Can it magically figure out all the types?

No, and I feel like anyone who tells you otherwise is selling something. The infer-types step does real inference where the language service can prove a type from how a value is used (and from propTypes on React components). Everything it can't prove falls back to `any` with a suppression comment. I'm very much of the mindset that a project that compiles today and gets better types incrementally beats a migration that stalls at 80% trying to be perfect.

> I see lots of `@ts-expect-error` and `any`. Is that expected?

Yes. The output is a starting point, not a finish line. That being said, two things shrink the wall of comments considerably. First, install your `@types` packages before migrating: on one plain CommonJS library I tested, roughly 90 of the 101 suppressions were just missing environment types (`require`, `describe`, and friends), not real type problems. Second, whenever you improve types or add `@types` packages later, re-run `npx -p @obiemunoz/ts-migrate ts-migrate reignore <folder>` to strip the suppressions that are no longer needed (if your tsconfig pins a `types` array — the generated one does — add the new package names there first).

> What is `$TSFixMe`?

An Airbnb convention this fork inherited: an alias for `any` (`type $TSFixMe = any;`, plus `$TSFixMeFunction` for function signatures). It made the follow-up work easy to grep for in their codebase. It's opt-in here with `--aliases tsfixme`; the default is plain `any`, because the alias only compiles if your project defines it as a global type.

> Does it work with ESLint 9 and flat configs?

Yes. The eslint-fix step loads your project's own ESLint installation and auto-detects flat versus legacy config (set `ESLINT_USE_FLAT_CONFIG` to override the detection). One caveat: if your ESLint can't parse TypeScript yet, there is nothing for it to fix. It warns and moves on, which is one more reason to get `@typescript-eslint` set up early.

> It's slow on my big repo.

Type inference is the expensive part, and it's several times faster now than it was when I forked the project. On a huge codebase you still have knobs: `--no-inferTypes` skips inference entirely, and `--maxStablePasses` caps how many times the repeating plugins re-run while files keep changing.

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
