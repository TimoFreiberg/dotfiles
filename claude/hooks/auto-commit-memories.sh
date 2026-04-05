#!/usr/bin/env bash
# Auto-commit and push memory edits.
# Called as a PostToolUse hook after Write/Edit.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Only act on files in the memories directory
case "$file_path" in
  */claude/memories/*) ;;
  *) exit 0 ;;
esac

# Resolve the real directory from the edited file and go to repo root
MEMORIES_DIR="$(dirname "$(readlink -f "$file_path")")"
cd "$MEMORIES_DIR/.." || exit 0

# Bail if not a jj repo
jj root &>/dev/null || exit 0

# Nothing changed? Bail.
[ -z "$(jj diff --git memories/)" ] && exit 0

jj commit memories/ -m "Update memories"
jj bookmark set main -r @-
jj git push

echo "Memory repo updated and pushed."
