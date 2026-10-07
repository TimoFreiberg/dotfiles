---
name: jj-workspaces
description: "Use when you want to work in an isolated jj working copy: parallel task, experimental scratch, subagent with its own tree. jj's equivalent of git worktrees: creating a workspace, working inside it from anywhere, and cleaning up without losing history."
---

A workspace is a separate checkout with its own `@` on the same repository.
History is shared: commits, rebases, and descriptions are visible from every
workspace at once, so never transfer commits between them; hand off the
change ID. Use one for parallel or scratch work that shouldn't disturb the
current `@`; for new work on top of `@`, just `jj new`.

Create it in the repo's `.workspaces/` directory (add `.workspaces/` to the
ignore file if missing), named after the task:

    jj workspace add --name NAME [-r <rev>] <repo>/.workspaces/NAME
    test ! -f <repo>/AGENTS.local.md || cp <repo>/AGENTS.local.md <repo>/.workspaces/NAME/

Then add a todo to clean it up. Work in it with `pushd .workspaces/NAME`.
If it goes stale, follow the `jj` skill.

To finish: commit, check that `@` is empty and `@-` holds the work, leave the
workspace with `popd`, run `jj workspace forget NAME` from the main workspace,
save any ignored or untracked files worth keeping, then `rm -rf` the directory.
The commit survives forgetting; integrating it elsewhere is a separate task.
