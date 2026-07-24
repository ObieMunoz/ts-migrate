#!/usr/bin/env bash

set -e

# Resolve this script's real location (following the symlinks npm/npx create
# in .bin) so the bundled CLI is found regardless of the working directory.
script_source=${BASH_SOURCE[0]:-$0}
while [ -L "$script_source" ]; do
  script_dir=$(cd -P "$(dirname "$script_source")" >/dev/null 2>&1 && pwd)
  script_source=$(readlink "$script_source")
  case $script_source in
    /*) ;;
    *) script_source=$script_dir/$script_source ;;
  esac
done
script_dir=$(cd -P "$(dirname "$script_source")" >/dev/null 2>&1 && pwd)
cli_js="$script_dir/../build/cli.js"

cli() {
  node "$cli_js" "$@"
}

usage="Usage: ts-migrate-full <folder> [--yes] [--no-commit] [--blame-ignore-revs] [--typescript <path>] [rename/migrate options...]"

# --yes, --no-commit, --blame-ignore-revs, --version, and --help belong to
# this script; everything else after the folder is forwarded to the rename and
# migrate commands. --typescript is both: forwarded to migrate and used to
# pick the compiler the check step runs.
auto_yes=false
no_commit=false
blame_ignore_revs=false
typescript_path=""
typescript_value_pending=false
frontend_folder=""
additional_args=()
for arg in "$@"; do
  if [ "$typescript_value_pending" = "true" ]; then
    typescript_path=$arg
    typescript_value_pending=false
    additional_args+=("$arg")
    continue
  fi
  case $arg in
    --yes|-y) auto_yes=true ;;
    --no-commit) no_commit=true ;;
    --blame-ignore-revs) blame_ignore_revs=true ;;
    --typescript)
      typescript_value_pending=true
      additional_args+=("$arg")
      ;;
    --typescript=*)
      typescript_path=${arg#*=}
      additional_args+=("$arg")
      ;;
    --version|-v) cli --version; exit ;;
    --help|-h) echo "$usage"; exit ;;
    --dry-run)
      # Each pipeline step works on the previous step's writes, so a dry run
      # of the whole pipeline cannot produce a meaningful preview.
      echo "ts-migrate-full does not support --dry-run. Preview the steps individually instead:"
      echo "  ts-migrate rename <folder> --dry-run"
      echo "  ts-migrate migrate <folder> --dry-run   # after a real rename"
      exit 1
      ;;
    *)
      if [ -z "$frontend_folder" ]; then
        frontend_folder=$arg
      else
        additional_args+=("$arg")
      fi
      ;;
  esac
done

if [ -z "$frontend_folder" ]; then
  echo "$usage"
  exit 1
fi
folder_name=$(basename "$frontend_folder")

# A scoped run must be reignored with the same scope, with the same compiler,
# and with the same lint engine, so the reignore hint printed on failure
# repeats the --sources, --typescript, and --no-projectEslint flags this run
# was invoked with.
reignore_cmd="npx -p @obiemunoz/ts-migrate ts-migrate reignore \"$frontend_folder\""
sources_value_pending=false
for arg in "${additional_args[@]}"; do
  if [ "$sources_value_pending" = "true" ]; then
    reignore_cmd+=" --sources \"$arg\""
    sources_value_pending=false
    continue
  fi
  case $arg in
    --sources=*|-s=*) reignore_cmd+=" --sources \"${arg#*=}\"" ;;
    --sources|-s) sources_value_pending=true ;;
    --no-projectEslint) reignore_cmd+=" --no-projectEslint" ;;
  esac
done
if [ -n "$typescript_path" ]; then
  reignore_cmd+=" --typescript \"$typescript_path\""
fi

step_i=1
step_count=4
# Set only by the prompt below; empty means the check runs whichever compiler
# the migrate step resolved.
tsc_path=""
should_remove_eslintrc=false

# The migrate step writes its type definition recommendations here so they can
# be shown at the end of the run, where they won't scroll out of view.
types_report_file=$(mktemp)
trap 'rm -f "$types_report_file"' EXIT


echo "Welcome to TS Migrate! :D

This script will migrate a frontend folder to a compiling (or almost compiling) TS project.

It is recommended that you take the following steps before continuing...

1. Make sure you have a clean git slate.
   Run \`git status\` to make sure you have no local changes that may get lost.
   Check in or stash your changes, then re-run this script.

2. Check out a new branch for the migration.
   For example, \`git checkout -b $(whoami)--ts-migrate\` if you're migrating several folders or
   \`git checkout -b $(whoami)--ts-migrate-$folder_name\` if you're just migrating $frontend_folder.

3. Make sure you're on the latest, clean master.
   \`git fetch origin master && git reset --hard origin/master\`

4. Make sure you have the latest npm modules installed.
   \`npm install\` or \`yarn install\`

5. For a cleaner result, install type definitions for your environment first,
   e.g. \`npm i -D @types/node\` plus the @types for your test runner (mocha, jest, ...).
   With those in place, globals like \`require\` and \`describe\` get real types
   instead of suppressed errors.

If you need help or have feedback, please file an issue at https://github.com/ObieMunoz/ts-migrate/issues
"

if [ "$auto_yes" != "true" ]; then
  read -p "Continue? (y/N) " should_fetch_and_reset || {
    echo "No input available; re-run with --yes to skip the prompts."
    exit 1
  }
  if [ "$should_fetch_and_reset" != "y" ] && [ "$should_fetch_and_reset" != "Y" ] # lol
  then
    echo "See you later."
    exit
  fi

  read -p "Set a custom path for the typescript compiler. (It's an optional step. Skip if you don't need it. By default the check runs the same compiler the migration used.): " custom_tsc_path || custom_tsc_path=""
  if [[ -z "$custom_tsc_path" ]]; then
    echo "The check will run the same compiler the migration used."
  else
    tsc_path=$custom_tsc_path;
  fi
fi

# Full SHAs of the mechanical commits this run creates, for the blame
# guidance at the end of the run.
migration_commits=()

function maybe_commit() {
  if [ "$no_commit" = "true" ]; then
    return
  fi
  cd $frontend_folder
  # Scope the dirtiness check to the folder being committed; `git status`
  # alone reports the whole repository, and changes elsewhere would send an
  # empty commit to `git commit`, which fails and aborts the run (set -e).
  if [[ `git status --porcelain .` ]]
  then
    git add . && git commit "$@"
    migration_commits+=("$(git rev-parse HEAD)")
  fi
  cd -
}

echo "
[Step $((step_i++)) of ${step_count}] Initializing ts-config for the \"$frontend_folder\"...
"

if [ ! -f "$frontend_folder/tsconfig.json" ]; then
  cli init $frontend_folder
fi

# Look for any ESLint config the project may have: extensionless .eslintrc,
# .eslintrc.{js,cjs,json,yml,...}, flat eslint.config.*, or package.json
# "eslintConfig". Unmatched globs stay literal, so -e correctly fails on them.
eslint_config_found=false
for eslint_config in "$frontend_folder"/.eslintrc "$frontend_folder"/.eslintrc.* "$frontend_folder"/eslint.config.*; do
  if [ -e "$eslint_config" ]; then
    eslint_config_found=true
    break
  fi
done
if [ "$eslint_config_found" != "true" ] && [ -f "$frontend_folder/package.json" ] \
  && grep -q '"eslintConfig"' "$frontend_folder/package.json"; then
  eslint_config_found=true
fi

if [ "$eslint_config_found" != "true" ]; then
  touch "$frontend_folder/.eslintrc"
  should_remove_eslintrc=true
fi

maybe_commit -m "[ts-migrate][$folder_name] Init tsconfig.json file" -m 'Co-authored-by: ts-migrate <>'

echo "
[Step $((step_i++)) of ${step_count}] Renaming files from JS/JSX to TS/TSX and updating project.json...
"
cli rename "$frontend_folder" "${additional_args[@]}"

maybe_commit -m "[ts-migrate][$folder_name] Rename files from JS/JSX to TS/TSX" -m 'Co-authored-by: ts-migrate <>'

echo "
[Step $((step_i++)) of ${step_count}] Fixing TypeScript errors...
"
cli migrate "$frontend_folder" --typesReportFile "$types_report_file" "${additional_args[@]}"

if [ "$should_remove_eslintrc" = "true" ]; then
  rm -f $frontend_folder/.eslintrc
fi

maybe_commit -m "[ts-migrate][$folder_name] Run TS Migrate" -m 'Co-authored-by: ts-migrate <>'


echo "
[Step $((step_i++)) of ${step_count}] Checking for TS compilation errors (there shouldn't be any).
"

# Prefer the requested tsc. Otherwise run the compiler the migrate step
# resolved: a check run by a different compiler reports TS2578 for
# suppressions the migration needed, and reignoring never converges.
tsc_cmd=("$tsc_path")
if [ ! -x "$tsc_path" ]; then
  if [ -n "$tsc_path" ]; then
    echo "No tsc found at $tsc_path; using the compiler the migration ran."
  fi
  migration_tsc=$(node -e '
    const path = require("path");
    const [cliJs, folder, override] = process.argv.slice(1);
    const { resolveTypeScript } = require(path.join(path.dirname(cliJs), "utils", "resolveTypeScript.js"));
    const { packageDir } = resolveTypeScript({
      rootDir: path.resolve(folder),
      override: override || undefined,
    });
    process.stdout.write(path.join(packageDir, "bin", "tsc"));
  ' "$cli_js" "$frontend_folder" "$typescript_path" 2>/dev/null)
  if [ -z "$migration_tsc" ] || [ ! -f "$migration_tsc" ]; then
    echo "Could not find the TypeScript compiler the migration used."
    exit 1
  fi
  tsc_cmd=(node "$migration_tsc")
fi

echo "${tsc_cmd[*]} -p $frontend_folder/tsconfig.json --noEmit"
check_failed=false
"${tsc_cmd[@]}" -p "$frontend_folder/tsconfig.json" --noEmit || check_failed=true

if [ "$check_failed" = true ]; then
  echo "
---
The TypeScript check failed. What the errors above usually mean:

- TS2578 (unused '@ts-expect-error'): the compiler running this check disagrees
  with the one the migration used. Both default to the project's own typescript
  (the migration log names the copy it ran), so a skew is left only when a
  custom tsc path was set above, or when the project's compiler is outside the
  range ts-migrate supports and the bundled one was used instead. Run the check
  with the compiler the migration named, make sure tsconfig.json pins a
  \"types\" array, then strip and re-add the suppressions with:
    $reignore_cmd
- Syntax errors (TS1xxx) in generated or third-party .d.ts files: those files
  are outside the migration's control (the migration log lists them). Fix or
  regenerate them, or exclude them in tsconfig.json — re-running the migration
  will not change them.
- Other type errors in migrated files: run the reignore command above to
  re-suppress them."

  if [ -s "$types_report_file" ]; then
    echo ""
    cat "$types_report_file"
  fi
  exit 1
fi

echo "
---
All done! Your project compiles with TypeScript now."

if [ -s "$types_report_file" ]; then
  echo ""
  cat "$types_report_file"
fi

# The mechanical rewrite commits are exactly what .git-blame-ignore-revs is
# for. Writing the file is opt-in: on squash or rebase merge workflows these
# SHAs never reach the main branch, and dangling SHAs in the file break
# git blame repo-wide for fresh clones.
wrote_ignore_revs=false
if [ "$blame_ignore_revs" = "true" ] && [ ${#migration_commits[@]} -gt 0 ]; then
  repo_root=$(git -C "$frontend_folder" rev-parse --show-toplevel)
  ignore_revs_file="$repo_root/.git-blame-ignore-revs"
  {
    echo "# ts-migrate $folder_name"
    printf '%s\n' "${migration_commits[@]}"
  } >> "$ignore_revs_file"
  wrote_ignore_revs=true
fi

echo "
Remaining cleanup — the rest of your tooling doesn't know about the rename yet:

1. Sanity check the commits (or, with --no-commit, the working tree).
2. Add a build step (tsc) or a TS-aware runner (ts-node, tsx). If package.json
   \"main\" pointed at a renamed file, point it at build output that exists.
3. Update scripts that reference old .js paths (mocha globs, jest patterns).
4. Teach ESLint about TypeScript (the @typescript-eslint parser and plugin)."

if [ ${#migration_commits[@]} -gt 0 ]; then
  echo "5. Keep git blame useful. This run created mechanical rewrite commits:"
  for sha in "${migration_commits[@]}"; do
    git -C "$frontend_folder" --no-pager show -s --format='     %H  %s' "$sha"
  done
  if [ "$wrote_ignore_revs" = "true" ]; then
    echo "   Their SHAs were appended to .git-blame-ignore-revs at the repository root.
   Review that file and commit it together with your cleanup changes."
  else
    echo "   If your team merges PRs with merge commits, add those full SHAs to a
   .git-blame-ignore-revs file at the repository root; re-running with
   --blame-ignore-revs writes it for you. If your team squash-merges or
   rebases, these SHAs will not exist on the main branch: add the SHA of the
   merged commit to the file after the merge instead."
  fi
  echo "   Once the file is committed, \`git config blame.ignoreRevsFile .git-blame-ignore-revs\`
   makes local git blame skip those commits; github.com applies the root file
   automatically.
6. Push your changes with \`git push\` and open a PR!
"
else
  echo "5. Push your changes with \`git push\` and open a PR!
"
fi
