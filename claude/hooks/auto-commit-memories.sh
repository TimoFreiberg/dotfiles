#!/usr/bin/env bash
# Auto-commit and push memory edits.
# Called as a PostToolUse hook after Write/Edit in the memories directory.

set -euo pipefail

# Resolve the real directory (memories/ is a symlink) and go to repo root
MEMORIES_DIR="$(readlink -f "$HOME/dotfiles/claude/memories")"
cd "$MEMORIES_DIR/.." || exit 0

# Bail if not a jj repo
jj root &>/dev/null || exit 0

# Nothing changed? Bail.
[ -z "$(jj diff --git agent-memories/)" ] && exit 0

jj commit agent-memories/ -m "Update memories"
jj bookmark set main -r @-
jj git push

echo "Memory repo updated and pushed."
