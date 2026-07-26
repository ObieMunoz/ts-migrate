<!--
Thanks for contributing! PRs are squash-merged, and the PR title becomes the
commit message on master. Lerna derives release versions from these messages,
so use a Conventional Commits title with the package as the scope, e.g.:

  fix(ts-migrate): handle spaces in tsconfig paths
  feat(ts-migrate-plugins): add update-import-paths plugin
  docs: clarify reignore usage

The PR Title workflow rejects titles that do not match this format.
-->

## Summary

<!-- What does this change and why? Link any related issue, e.g. "Fixes #123". -->

## Testing

<!-- How you verified the change: commands run, new or updated tests, manual checks. -->

## Checklist

- [ ] `pnpm run build`, `pnpm run test`, and `pnpm run lint` pass locally
- [ ] Tests added or updated for behavior changes
- [ ] Docs updated where relevant (package README, `packages/ts-migrate/AGENTS.md` for CLI behavior changes)
- [ ] PR title follows Conventional Commits with a package scope (drives lerna versioning)
