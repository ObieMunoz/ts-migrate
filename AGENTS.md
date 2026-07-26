# Repository conventions

Standing rules for agents changing this repository. The detail lives in
[CONTRIBUTING.md](./CONTRIBUTING.md); this is the short version.

Not to be confused with `packages/ts-migrate/AGENTS.md`, which is the published
playbook for agents driving the ts-migrate CLI against another project. Nothing
here applies to that.

## Dependencies

pnpm only. The workspace is defined by `pnpm-workspace.yaml` and the pnpm
version is pinned by `packageManager` in `package.json`.

**Never run `pnpm add`.** It reruns peer resolution for the whole workspace, and
every package declares TypeScript as a peer with the range `>=5.0 <7`, so the
pass satisfies those ranges with the 6.0.3 copy `ts-migrate-server` keeps for
its TypeScript 6 tests and rewrites the committed 5.9.3 resolutions. The build
then fails with cross-package `TypeChecker` and `Symbol` assignability errors in
files the change never touched. Add a dependency by editing the `package.json`
by hand, running `pnpm install`, and confirming that
`git diff --stat pnpm-lock.yaml` shows insertions only. See "Adding a
dependency" in CONTRIBUTING.md. `scripts/check-lockfile-typescript.sh
origin/master` runs the CI check locally.

## Verifying a change

`pnpm run build`, `pnpm run test`, and `pnpm run lint` from the repo root, all
three, before opening a pull request. Tests live in `packages/*/tests/`.

The command tests write scratch projects under
`packages/ts-migrate-test-utils/tests/tmp`, and a `globalTeardown` removes them
after every run. Run with `TS_MIGRATE_KEEP_TEST_TMP=1` to keep them while
debugging a run that died.

The filesystem and logging helpers the suites share live in
`packages/ts-migrate-test-utils`, a private package that is never published.
Import them by name, not by reaching across packages with a relative path. Each
package's own `tests/test-utils.ts` is for helpers only that package needs.

It is a devDependency of the root `package.json` and of no other manifest, the
way the test suites already resolve `glob`. A package that declared it would
carry it into its published `devDependencies`, pointing at a version no registry
will ever have.

The root build and lint scripts are `pnpm -r`. lerna is release-only: only
`release.yml` invokes it, and `ci.yml` never does. Do not reach for it to verify
a change, and note that it misresolves the workspace from a nested git worktree.

## Pull requests

Titles are Conventional Commits, `type(scope): subject`. `pr-title.yml` enforces
the format, and lerna reads master's commit messages to build the release notes,
so a bare area prefix such as `cli: ...` is dropped from the changelog.

Issue and pull request text uses plain punctuation, no em or en dashes. The
package READMEs and the CLI playbook predate this and still use them; they are
not being swept.

Pushing a change under `.github/workflows/` needs the SSH remote. The HTTPS
remote rejects it with "refusing to allow an OAuth App to create or update
workflow" unless the token carries the `workflow` scope.

## Documentation

CLI behavior changes go in `packages/ts-migrate/AGENTS.md` as well as the
package README. `agentsPlaybook.test.ts` asserts on the playbook's content, and
`ci.yml` deliberately does not path-ignore it.

Every `npx` example must be scoped: `npx -p @obiemunoz/ts-migrate ts-migrate
...`. A bare `npx ts-migrate` fetches the unmaintained upstream package.
