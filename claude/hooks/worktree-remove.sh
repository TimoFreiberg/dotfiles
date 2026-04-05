#!/bin/bash

input=$(cat)
WORKTREE_PATH=$(echo "$input" | jq -r .worktree_path)
NAME=$(basename "$WORKTREE_PATH")
CWD=$(echo "$input" | jq -r .cwd)

if [ -d "$WORKTREE_PATH/.jj" ]; then
  jj -R "$WORKTREE_PATH" workspace forget "$NAME" 2>/dev/null || true
  rm -rf "$WORKTREE_PATH"
else
  cd "$CWD" || exit 1
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || {
    rm -rf "$WORKTREE_PATH"
    git worktree prune 2>/dev/null || true
  }
fi
