#!/usr/bin/env bash

# The pipeline this used to hold is `ts-migrate full <folder>`, which shares the
# CLI's parser, its reports and its summaries instead of restating them. What is
# left here is the entry point npm installs as `ts-migrate-full`, so no
# documented invocation breaks; every flag is the command's.

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

exec node "$script_dir/../build/cli.js" full "$@"
