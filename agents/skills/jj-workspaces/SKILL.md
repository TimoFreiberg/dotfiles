---
name: jj-workspaces
description: "Use when you want to work in an isolated jj working copy — parallel task, experimental scratch, subagent with its own tree. jj's equivalent of git worktrees: creating a workspace, working inside it from anywhere, and cleaning up without losing history."
---

# jj workspaces

Workspaces isolate checked-out files and each workspace's `@` (working-copy
commit), not repository history. They share one repository: ordinary `jj new`,
`jj describe`, `jj commit`, and `jj rebase` operations are immediately visible
from other workspaces. No fetch, push, or transfer between workspaces is needed.
File edits enter shared repository state when jj snapshots the edited
workspace, usually at its next command.

From another workspace, use the finished commit's change ID as a revision, for
example `jj log -r <change-id>`. This references the commit without checking it
out, changing that workspace's files, or integrating it into its branch.

## When to use

- You want to try something without disrupting your current `@` (WIP pile,
  in-progress conflict resolution, mid-rebase).
- A subagent or parallel task needs its own tree on a different revision.
- You're investigating an old commit and want a separate checkout to poke
  at without rewinding your main one.

Not the right tool for:

- "New change on top of current work" — that's `jj new`.
- Cross-repo work — use `jj -R <path>` to operate on a different repo.
  Workspaces share the same repo; they're not independent clones.

## Create

```bash
# Create the workspace directory inside the repo (if needed)
mkdir -p /abs/path/to/repo/.workspaces

# Default: shares parents with current @
jj workspace add --name NAME /abs/path/to/repo/.workspaces/NAME

# With an explicit base revision
jj workspace add --name NAME -r <rev> /abs/path/to/repo/.workspaces/NAME

# Copy repository-local instructions into the workspace, if present
test ! -f /abs/path/to/repo/AGENTS.local.md || cp /abs/path/to/repo/AGENTS.local.md /abs/path/to/repo/.workspaces/NAME/AGENTS.local.md
```

Convention: put workspaces in the repo's `.workspaces` directory, using the
workspace name as the directory name. Repo at `~/src/pantoken` with workspace
`feature-1` → `~/src/pantoken/.workspaces/feature-1/`. Keeps `jj log`'s
`<name>@` marker meaningful without needing a project prefix in the directory
name.

Because `.workspaces` lives inside the repository, add it to the repository's
ignore file so the main working copy does not scan workspace contents as
changes:

```gitignore
.workspaces/
```

`NAME` appears in `jj workspace list` and as `<name>@` in `jj log` from any
workspace. Pick something descriptive; you'll see it until you `forget`.

When the harness supports todos, create a todo immediately after creating the
workspace to remind yourself to clean it up when the task is complete. A
workspace is not finished until it has been checked, forgotten, and its
workspace directory removed.

## Work inside

You don't have to `cd` into the workspace. jj accepts a repo path via
`-R`, and most tools handle absolute paths:

```bash
# Target the workspace from anywhere
jj -R /abs/path/to/workspace st
jj -R /abs/path/to/workspace log
jj -R /abs/path/to/workspace commit /abs/path/to/workspace/file.ts -m "msg"
```

Don't rely on `cd` persisting between tool calls. For one-shot ops,
`jj -R <abs-path>` is the cheapest shape. For a concentrated stretch
inside the workspace, chain with `;` or `&&` in a single call:

```bash
cd /abs/path/to/workspace && jj st && jj new -m scratch
```

## Stale working copies

Rewriting another workspace's `@`, directly or through an ancestor rewrite
(rebase, squash, abandon), changes shared history without updating that
workspace's files. Its checkout can become stale. Creating an independent
leaf commit does not inherently stale other workspaces.

Before running `jj workspace update-stale`, read the
[jj stale-workspace guidance](../jj/SKILL.md#stale-workspaces) and protect
local work; do not treat the suggested recovery command as routine cleanup.

## Clean up

For an implementer finishing a leaf commit:

1. Write code and complete verification, tests, and review.
2. Review `jj diff --git`, then `jj commit <owned-paths...> -m "Commit message"`.
3. Run `jj status && jj diff --stat -r @-`. Confirm `@` is empty and `@-`
   contains the intended files. If changes remain in `@`, account for them
   before cleanup. The stat is a sanity check; use `jj diff --git -r @-` for
   patch review. Record the parent's change ID with `jj log -r @-` for handoff.
4. Leave the workspace. If you entered with the harness's `pushd` tool, use
   its `popd` tool; shell `popd` applies only to a shell's own directory stack.
5. From the main workspace, run `jj workspace forget NAME`.
6. Check for untracked or ignored files worth keeping (`jj status` does not
   show ignored files), preserve any needed files, then remove the directory:
   `rm -rf /abs/path/to/workspace`.

`jj commit` leaves the finished work in `@-` and creates a fresh empty `@`.
The finished parent is already in the shared repository and survives
`workspace forget` without a bookmark, push, or rebase. Forgetting removes
the workspace registration and can abandon its disposable empty working-copy
commit; it does not delete the directory. Integration into another branch is
a separate task, not a prerequisite for cleanup.

## Common mistakes

- **`rm -rf` without `workspace forget`** — main repo keeps a dead entry
  in `jj workspace list`. Not data loss, just noise. Fix with
  `jj workspace forget NAME` after the fact.
- **Transferring commits between workspaces**: history is already shared.
  Hand off the finished change ID; bookmark, push, or rebase only when the
  task calls for naming, publishing, or integrating the work.
- **Removing the directory before verifying the commit**: check that `@` is
  empty, review `@-`, and preserve needed untracked or ignored files first.
- **Relative path to `-R`** — resolved against cwd, not the workspace.
  Use absolute paths when targeting a non-current workspace.
- **Editing in the workspace while the main checkout is also open on
  overlapping files** — each workspace's `@` is its own head, which is
  normal; the real risk is both editing the same paths and conflicting
  when the work is later merged or rebased together. Prefer one active
  workspace per logical task.
