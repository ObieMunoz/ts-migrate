## Overview

[pnpm workspaces](https://pnpm.io/workspaces) are used to manage dependencies and
build config across packages and
[lerna](https://github.com/lerna/lerna/) is used to manage versioning and publishing.

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
