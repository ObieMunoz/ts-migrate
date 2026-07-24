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

usage="Usage: ts-migrate-full <folder> [--yes] [--no-commit] [rename/migrate options...]"

# --yes, --no-commit, --version, and --help belong to this script; everything
# else after the folder is forwarded to the rename and migrate commands.
auto_yes=false
no_commit=false
frontend_folder=""
additional_args=()
for arg in "$@"; do
  case $arg in
    --yes|-y) auto_yes=true ;;
    --no-commit) no_commit=true ;;
    --version|-v) cli --version; exit ;;
    --help|-h) echo "$usage"; exit ;;
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

# A scoped run must be reignored with the same scope, so the reignore hint
# printed on failure repeats the --sources flags this run was invoked with.
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
  esac
done

step_i=1
step_count=4
tsc_path="./node_modules/.bin/tsc"
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

  read -p "Set a custom path for the typescript compiler. (It's an optional step. Skip if you don't need it. Default path is ./node_modules/.bin/tsc.): " custom_tsc_path || custom_tsc_path=""
  if [[ -z "$custom_tsc_path" ]]; then
    echo "Your default tsc path is $tsc_path."
  else
    tsc_path=$custom_tsc_path;
  fi
fi

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
[Step $((step_i++)) of ${step_count}] Renaming files from JS/JSX to TS/TSX and updating project.json\...
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

# Prefer the requested tsc, then the target project's own install, then the
# compiler bundled with ts-migrate (plain JS projects usually have no tsc).
tsc_cmd=("$tsc_path")
if [ ! -x "$tsc_path" ]; then
  if [ -x "$frontend_folder/node_modules/.bin/tsc" ]; then
    tsc_cmd=("$frontend_folder/node_modules/.bin/tsc")
  else
    bundled_tsc=$(node -e '
      const path = require("path");
      const req = require("module").createRequire(process.argv[1]);
      process.stdout.write(path.join(path.dirname(req.resolve("typescript")), "..", "bin", "tsc"));
    ' "$cli_js" 2>/dev/null)
    if [ -z "$bundled_tsc" ] || [ ! -f "$bundled_tsc" ]; then
      echo "Could not find a TypeScript compiler at $tsc_path or bundled with ts-migrate."
      exit 1
    fi
    echo "No tsc found at $tsc_path; using the compiler bundled with ts-migrate."
    tsc_cmd=(node "$bundled_tsc")
  fi
fi

echo "${tsc_cmd[*]} -p $frontend_folder/tsconfig.json --noEmit"
check_failed=false
"${tsc_cmd[@]}" -p "$frontend_folder/tsconfig.json" --noEmit || check_failed=true

if [ "$check_failed" = true ]; then
  echo "
---
The TypeScript check failed. What the errors above usually mean:

- TS2578 (unused '@ts-expect-error'): the compiler running this check disagrees
  with the one the migration used — usually a typescript version mismatch
  between the project and ts-migrate (the migration log prints a warning when
  it detects one). Align the versions, make sure tsconfig.json pins a \"types\"
  array, then strip and re-add the suppressions with:
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

echo "
Remaining cleanup — the rest of your tooling doesn't know about the rename yet:

1. Sanity check the commits (or, with --no-commit, the working tree).
2. Add a build step (tsc) or a TS-aware runner (ts-node, tsx). If package.json
   \"main\" pointed at a renamed file, point it at build output that exists.
3. Update scripts that reference old .js paths (mocha globs, jest patterns).
4. Teach ESLint about TypeScript (the @typescript-eslint parser and plugin).
5. Push your changes with \`git push\` and open a PR!
"
