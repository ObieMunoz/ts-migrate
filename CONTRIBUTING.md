## Overview

[pnpm workspaces](https://pnpm.io/workspaces) are used to manage dependencies and
build config across packages and
[lerna](https://github.com/lerna/lerna/) is used to manage versioning and publishing.

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
