#!/bin/bash
set -e

input=$(cat)
NAME=$(echo "$input" | jq -r .name)
CWD=$(echo "$input" | jq -r .cwd)
DIR="$HOME/.claude/worktrees/$NAME"

mkdir -p "$HOME/.claude/worktrees"
cd "$CWD"

if jj root >/dev/null 2>&1; then
  jj workspace add "$DIR" --name "$NAME" >&2
else
  git worktree add -b "claude/$NAME" "$DIR" >&2
fi

echo "$DIR"
