#!/usr/bin/env bash
#
# Fails when pnpm-lock.yaml moves a package's TypeScript resolution.
#
# Every package here declares typescript as a peer with the range ">=5.0 <7",
# and ts-migrate-server keeps a 6.0.3 copy for its TypeScript 6 tests, so any
# full peer resolution pass (what `pnpm add` runs) can satisfy those ranges
# with 6.0.3 and rewrite the committed 5.9.3 resolutions. Two compiler copies
# in one type graph produce cross-package TypeChecker and Symbol assignability
# errors in files the change never touched.
#
# Usage: scripts/check-lockfile-typescript.sh [base-ref]
#
# A pull request that also edits a package.json line mentioning typescript is
# treated as a deliberate compiler change and passes.

set -euo pipefail

base="${1:-origin/master}"
lockfile='pnpm-lock.yaml'

if ! git rev-parse --verify --quiet "${base}" > /dev/null; then
  echo "check-lockfile-typescript: cannot resolve base ref ${base}" >&2
  exit 2
fi

if git diff --quiet "${base}" -- "${lockfile}"; then
  echo "${lockfile} is unchanged against ${base}"
  exit 0
fi

# Prints "<importer>\t<typescript version>" for every typescript version an
# importer resolves to, directly or through a peer key such as
# "ts-jest@29.4.11(typescript@5.9.3)". Bumping ts-jest leaves the set alone;
# flipping the compiler changes it.
extract() {
  awk '
    function collect(value, importer,   rest) {
      rest = value
      while (match(rest, /typescript@[^ ()]+/)) {
        print importer "\t" substr(rest, RSTART + 11, RLENGTH - 11)
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    /^importers:$/ { block = 1; next }
    block && /^[^ ]/ { block = 0 }
    !block { next }
    /^  [^ ].*:$/ { importer = substr($0, 3); sub(/:$/, "", importer); dep = ""; next }
    /^      [^ ].*:$/ { dep = substr($0, 7); sub(/:$/, "", dep); next }
    /^        version: / {
      value = substr($0, 18)
      if (dep == "typescript") print importer "\t" value
      collect(value, importer)
    }
  ' | sort -u
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

git show "${base}:${lockfile}" | extract > "${work}/base"
extract < "${lockfile}" > "${work}/head"

flips=0
while IFS= read -r importer; do
  before="$(awk -F'\t' -v i="${importer}" '$1 == i { print $2 }' "${work}/base" | paste -sd ' ' -)"
  after="$(awk -F'\t' -v i="${importer}" '$1 == i { print $2 }' "${work}/head" | paste -sd ' ' -)"
  # An importer with no typescript entry left was dropped or rewritten on
  # purpose, and that shows up in its package.json.
  if [ -n "${after}" ] && [ "${before}" != "${after}" ]; then
    echo "  ${importer}: ${before} -> ${after}"
    flips=$((flips + 1))
  fi
done < <(cut -f1 "${work}/base" | sort -u)

if [ "${flips}" -eq 0 ]; then
  echo "${lockfile} adds entries without moving a TypeScript resolution"
  exit 0
fi

if git diff "${base}" -- '*package.json' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -q 'typescript'; then
  echo "Resolutions moved alongside a typescript change in a package.json, allowing it"
  exit 0
fi

cat >&2 <<'EOF'

pnpm-lock.yaml moves an existing TypeScript resolution and no package.json in
this change touches typescript. This is what `pnpm add` does in this workspace:
it reruns peer resolution and satisfies the ">=5.0 <7" peer ranges with the
6.0.3 copy ts-migrate-server keeps for its TypeScript 6 tests. The build then
fails with cross-package TypeChecker and Symbol assignability errors in files
the change never touched.

To add a dependency: edit the package.json by hand, run `pnpm install`, and
confirm `git diff --stat pnpm-lock.yaml` shows insertions only. See the
"Adding a dependency" section of CONTRIBUTING.md.

To change the compiler on purpose, edit the typescript version in the relevant
package.json in the same change.
EOF
exit 1
