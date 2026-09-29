---
name: jj
description: "Use when committing, rebasing, inspecting history, or fixing repo state with jj (Jujutsu) — including colocated .git/.jj repos, detached-HEAD confusion, and stale-workspace recovery. Flags interactive commands that hang agents."
---

# jj Command Reference

For flags and syntax details, run `jj <subcommand> --help`.

See [reference.md](reference.md) for advanced topics (rewriting history, splitting commits, revsets).

## Key Concepts

- **Working copy (`@`)**: The current change, automatically tracks file modifications.
- **Changes vs commits**: A change has a stable _change ID_ (short, letters only); a commit has a _commit ID_ (hex). Prefer change IDs in commands.
- **Immutable revisions**: By default, `trunk()`, tags, and untracked remote bookmarks (and their ancestors) are immutable. Local bookmarks off trunk are mutable. Use `jj new` to create a mutable change on top.

## Shared history across workspaces

Workspaces isolate checked-out files and each workspace's `@`, not repository
history. Ordinary `jj new`, `jj describe`, `jj commit`, and `jj rebase`
operations change shared repository state immediately; no fetch, push, or
transfer between workspaces is needed. File edits enter that shared state when
jj snapshots the edited workspace, usually at its next command.

Rewriting another workspace's `@`, directly or through an ancestor rewrite,
can leave its on-disk checkout stale. Creating an independent leaf does not
inherently stale other workspaces. A finished commit is already available to
all workspaces, but visibility does not change their checked-out files or
integrate the commit into another branch.

After `jj commit`, verify that `@` is empty and `@-` contains the intended
changes. The parent survives forgetting the workspace without a bookmark,
push, or rebase. See [jj-workspaces](../jj-workspaces/SKILL.md#clean-up) for
the finish-and-cleanup sequence.

## Graph view for orientation

Especially when rearranging branch history, the commit tree can be hard to navigate without a graph view.
The bare `jj` command prints a graph of all commits that are effectively in progress.
If that prints too much, find the first commit of the current branch via `jj log -r 'trunk()::@'` and then run `jj log -r '<commit-id>::` to print the entire tree under the given commit.

## Squashing

**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message`. Bare `jj squash` opens an interactive editor and will hang.

Without `--to`, squash targets the direct parent only; pass `--from <rev> --to <rev>` to squash into an arbitrary commit regardless of history.

The same trap applies to bare `jj describe` and `jj commit` — always pass `-m "msg"`. Avoid `jj diffedit` entirely (always interactive).

## Splitting Commits

Do **not** use `jj split` — it is interactive and will hang. See the
[agent-friendly splitting methods](reference.md#splitting-commits-agent-friendly)
in the advanced reference.

## File Tracking

`jj file untrack <paths>` stops tracking paths in the working copy. Paths must already be in `.gitignore`. Useful when files were accidentally committed before being ignored.

## Colocated Repos (.jj and .git side by side)

A detached git HEAD is **normal** here — jj exports the working-copy commit,
which usually has no branch. Don't "fix" it with git, and don't mutate state
from the git side (`git commit`, `git merge`, `git checkout`): jj snapshots
the working copy on its next command and the two models fight. Use the jj
equivalent; read-only git commands (`git log`, `git status`) are always fine.

## Verifying a Branch Is Safe to Delete

In a clone or worktree that isn't continuously fetched, **both** local `main`
and `main@origin` can be stale. The obvious safety signals then lie:

- `jj diff --from main --to <bookmark>` showing the branch as still *adding*
  content
- the bookmark not showing as an ancestor of `main`
  (`jj log -r '<bookmark> & ::main'` empty)

Both can be artifacts of stale refs, not real unmerged work — especially
under **squash-merge**, where a merged branch is never an ancestor of `main`
even after its content fully landed (so the ancestry check is unreliable; the
diff is the signal that matters).

Before deleting, refresh first: `jj git fetch` (or compare against an
authoritative source — `gh api repos/<owner>/<repo>/commits/main`, a deployed
tree). Then `jj diff --from main@origin --to <bookmark>` going empty confirms
the content landed and the branch is safe to drop. If you can't fetch
(permissions), triangulate against the authoritative source instead of
trusting local refs.

Recovery if wrong: deleting a bookmark is just another operation —
`jj undo` reverts it (or `jj op restore` to an earlier op; recover the
change/commit id from `jj op log`). No reflog needed; the op log records
every change.

## Undoing Operations

If a command puts the wrong changes into the wrong commit (e.g. squash into the wrong parent), **don't try to manually fix the commits** — revert the operation instead:

1. Check the commit log: `jj log`
2. Check the operation log: `jj op log`
3. Revert the bad operation: `jj op revert <op_id>` (the op ID is shown in `jj op log`)

`jj op revert` undoes one operation; `jj op restore <op_id>` resets the whole repo to the state as of that operation (undoing everything after it).

## Stale Workspaces

When jj reports that a workspace is stale (for example, after another workspace
rewrites its working-copy parent), snapshotting commands are blocked. `jj st`,
`jj commit`, and `jj new` cannot run first. Run `jj workspace update-stale`
directly. It saves on-disk edits into history before checking out the updated
commit, so tracked edits remain recoverable even if their files are replaced on
disk.

Usually, no other agent or session should be writing files in this workspace.
Concurrent writes during checkout are the realistic risk of losing edits.
If you notice edits happening concurrently to your session, don't proceed,
escalate to the operator to synchronize.

Afterward, read the command output and run `jj log`:

- If the output says `Concurrent modification detected` or `jj log` shows a
divergent `@` (`??`), the local edits are in the other commit of the divergent
change, not in `@`. Compare it with `jj diff --from @ --to <other-commit-id>`,
bring the needed paths into `@` with
`jj restore --from <other-commit-id> --into @ <paths>`, resolve any conflict
markers, then run `jj abandon <other-commit-id>` once its changes are recovered.
- If `jj log` shows `RECOVERY COMMIT FROM jj workspace update-stale`, that
commit holds the old state. Build on it or restore the needed changes from it.
- Ignored, untracked, and oversized files are left on disk untouched by
checkout. Review any needed files separately after recovery; they are not part
of the saved tracked edits.

If edits still appear to be missing, find the operation just before
`update-stale` in `jj op log`. Inspect it with `jj op show <op-id>`;
`jj --at-op=<op-id> log` shows the repository state at that operation. Use
`jj file show -r <revision> <path>` to read the old tracked content.
