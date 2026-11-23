---
name: diff-review
description: Use when the operator wants to see, review, or comment on a jj diff (a change, a stack, a range), or asks for the diff in Lavish.
---

Workspace diffs live in the Lavish workspace hub's built-in `changes` and
`commits` views (`lavish-kit diff` no longer exists).

1. Reuse a ready hub for the workspace if this session already started one
   (check `list_jobs` with `show_type: ["shell_service"]` and `show_dead: true`,
   verifying `Hub owner running for <workspace>` in its current attempt's logs).
   Otherwise load the `hub` skill and start one.
2. Select the `changes` view (or `commits` for commit descriptions and stack
   overview), leaving out `--open` so no browser tab pops up:

   ```sh
   lavish-kit hub --workspace "$LAVISH_HUB_WORKSPACE" --view changes
   ```

The hub keeps the workspace's jj diff up to date automatically. It does not
support arbitrary revision ranges, git-only diffs, or stdin patches — if the
operator asks for one of those, explain the limitation instead of falling back
to standalone `lavish-axi`.

Feedback and replies go through the `hub` skill (`lavish-kit reply`). Keep the
hub running until the operator asks to stop it; don't run `lavish-axi end`.
