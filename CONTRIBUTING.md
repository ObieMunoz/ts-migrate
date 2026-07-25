## Overview

[pnpm workspaces](https://pnpm.io/workspaces) are used to manage dependencies and
build config across packages and
[lerna](https://github.com/lerna/lerna/) is used to manage versioning and publishing.

[AGENTS.md](./AGENTS.md) at the repo root is the short version of this document
for coding agents; keep the two in step. It is unrelated to
`packages/ts-migrate/AGENTS.md`, which is the published playbook for driving the
CLI against another project.

## Pull request titles

PRs are squash-merged, and the PR title becomes the commit message on master.
Lerna reads master's commit messages as
[Conventional Commits](https://conventionalcommits.org) to pick the next
version and to write the changelogs and GitHub release notes.

Title format: `type(scope): subject`, for example `feat(cli): add a --dry-run flag`.
Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`,
`build`, `ci`, `chore`, `revert`.

Only `feat`, `fix`, and `perf` entries appear in release notes, and `feat` is
what turns a release into a minor instead of a patch. A bare area prefix such
as `cli: add a flag` parses as an unknown type: the release still happens, but
the notes say "Version bump only" and the change is missing from the changelog.

The `PR Title` workflow enforces the format on every pull request.

## Project structure

```
ts-migrate/
  lerna.json
  package.json
  pnpm-workspace.yaml
  packages/
    ts-migrate/
      tests/
      build/
      package.json
      ...
    ts-migrate-server/
    ts-migrate-plugins/
    ts-migrate-example
```

## Local development

Run the following to setup your local dev environment:

```sh
# Install `pnpm`, alternatives at https://pnpm.io/installation
brew install pnpm

# Clone or fork `ts-migrate`
git clone git@github.com:ObieMunoz/ts-migrate.git # or your fork
cd ts-migrate

# install dependencies
pnpm install

# build packages
pnpm run build

# test packages
pnpm run test

# lint packages
pnpm run lint
```

The repo pins its pnpm version via the `packageManager` field in `package.json`;
any pnpm >= 9.7 will automatically fetch and run the pinned version.

## Test scratch projects

The command tests copy a fixture project into
`packages/<pkg>/tests/tmp/ts-migrate-XXXXXX`, and each suite deletes its own
copy in `afterEach`. A run that dies first, on a timeout or a signal, leaves the
copy on disk, so `scripts/jest-global-teardown.js` removes
`packages/*/tests/tmp` once the run has finished. It runs whether the run passed
or failed.

A leftover copy is also the only record of what a run had written when it died.
To keep it while debugging one:

```sh
TS_MIGRATE_KEEP_TEST_TMP=1 pnpm run test
```

The teardown then prints how many scratch projects it kept and where. They are
gitignored, and the next run without the variable removes them.

## Adding a dependency

Do not use `pnpm add` here. It reruns peer resolution for the whole workspace,
and every package declares TypeScript as a peer with the range `>=5.0 <7`.
`ts-migrate-server` also carries `typescript6` (`npm:typescript@6.0.3`) as a
devDependency so the TypeScript 6 tests have a compiler to load. A fresh
resolution sees 6.0.3 in the workspace, satisfies those peer ranges with it,
and rewrites the committed 5.9.3 resolutions across the workspace.

Add the dependency by hand instead:

1. Edit the `package.json` of the package that needs it.
2. Run `pnpm install` from the repo root.
3. Confirm `git diff --stat pnpm-lock.yaml` shows insertions only. Removed
   lines are the signal: `git diff pnpm-lock.yaml | grep '^-.*typescript@'`
   prints nothing unless you are changing the compiler on purpose.

A flipped lockfile puts two copies of the compiler in one type graph, so the
build fails with about 70 cross-package `TypeChecker` and `Symbol`
assignability errors in files the change never touched:

```
src/plugins/hoist-arrow-functions.ts(24,55): error TS2345: Argument of type
  'import(".../@obiemunoz/ts-migrate-server/node_modules/typescript").TypeChecker'
  is not assignable to parameter of type
  'import(".../ts-migrate-plugins/node_modules/typescript").TypeChecker'.
```

Those errors name no dependency and survive a rebuild, so they read as a broken
change. Recover with `git checkout -- pnpm-lock.yaml` followed by
`pnpm install --frozen-lockfile`.

The `lockfile` CI job fails a pull request whose `pnpm-lock.yaml` moves a
package's TypeScript resolution. Run the same check locally with
`scripts/check-lockfile-typescript.sh origin/master`. A pull request that
changes the compiler on purpose passes it by editing the `typescript` version
in a `package.json` in the same change.
