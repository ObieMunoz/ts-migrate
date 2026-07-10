#!/usr/bin/env bash

set -e

frontend_folder=$1
folder_name=`basename $1`

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

step_i=1
step_count=4
tsc_path="./node_modules/.bin/tsc"
should_remove_eslintrc=false
additional_args="${@:2}"


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

read -p "Continue? (y/N) " should_fetch_and_reset
if [ "$should_fetch_and_reset" != "y" ] && [ "$should_fetch_and_reset" != "Y" ] # lol
then
  echo "See you later."
  exit
fi

read -p "Set a custom path for the typescript compiler. (It's an optional step. Skip if you don't need it. Default path is ./node_modules/.bin/tsc.): " custom_tsc_path
if [[ -z "$custom_tsc_path" ]]; then
  echo "Your default tsc path is $tsc_path."
else
  tsc_path=$custom_tsc_path;
fi

function maybe_commit() {
  cd $frontend_folder
  if [[ `git status --porcelain` ]]
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
cli rename $frontend_folder $additional_args

maybe_commit -m "[ts-migrate][$folder_name] Rename files from JS/JSX to TS/TSX" -m 'Co-authored-by: ts-migrate <>'

echo "
[Step $((step_i++)) of ${step_count}] Fixing TypeScript errors...
"
cli migrate $frontend_folder $additional_args

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
"${tsc_cmd[@]}" -p $frontend_folder/tsconfig.json --noEmit

echo "
---
All done!

Your project compiles with TypeScript now. That being said, the rest of your
tooling doesn't know about the rename yet, so there is usually some cleanup
left before everything runs again:

1. Sanity check your changes locally by inspecting the commits.

2. Give the project a way to produce JS again: add a build step (tsc) or a
   TS-aware runner (ts-node, tsx). If package.json \"main\" pointed at a renamed
   file, point it at build output that actually exists.

3. Update scripts that reference old .js paths, like a mocha glob of
   test/*.js, jest patterns, or docs generators.

4. Teach ESLint about TypeScript (the @typescript-eslint parser and plugin).
   Until then, linting will either fail to parse .ts files or find no files at all.

5. Install any missing @types packages (@types/node, your test runner), then
   re-run \`ts-migrate reignore <folder>\` to drop suppressions you no longer need.

6. Push your changes with \`git push\` and open a PR!
"
