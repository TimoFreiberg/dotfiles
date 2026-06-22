---
name: jj
description: "Use when committing, rebasing, inspecting history, or fixing repo state with jj (Jujutsu) — including colocated .git/.jj repos, detached-HEAD confusion, and stale-workspace errors (read this before running `jj workspace update-stale`; it can silently discard uncommitted changes). Flags interactive commands that hang agents."
---

# jj Command Reference

For flags and syntax details, run `jj <subcommand> --help`.

See [reference.md](reference.md) for advanced topics (rewriting history, splitting commits, revsets).

## Key Concepts

- **Working copy (`@`)**: The current change, automatically tracks file modifications.
- **Changes vs commits**: A change has a stable _change ID_ (short, letters only); a commit has a _commit ID_ (hex). Prefer change IDs in commands.
- **Immutable revisions**: By default, `trunk()`, tags, and untracked remote bookmarks (and their ancestors) are immutable. Local bookmarks off trunk are mutable. Use `jj new` to create a mutable change on top.

## Squashing

**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message`. Bare `jj squash` opens an interactive editor and will hang.

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

When jj reports a workspace is stale (e.g. the working-copy parent was rewritten
in another workspace — often a concurrent session), it helpfully suggests
`jj workspace update-stale`. **Don't run it reflexively.** A tool error that
hands you its own recovery command reads as routine, but this one is destructive:
`update-stale` can **overwrite the workspace contents**, and any uncommitted
changes in the working copy are silently lost. Committed changes survive — they
get rebased onto the rewritten parent — so the fix is to commit *before*
recovering, not after losing work.

Before running `jj workspace update-stale`:

1. **Commit any uncommitted changes first** — `jj commit <paths> -m "msg"`. A
   committed change is rebased by `update-stale`, not discarded. This is the
   reliable protection. (`jj new` to park them on a fresh change works too.)
2. If you genuinely can't commit, back up the workspace contents instead:
   `cp -r <workspace-dir> <workspace-dir>.backup`
3. Run `jj workspace update-stale` in the workspace.
4. If you used a backup, merge it back and commit:
   `rsync -a --ignore-existing <workspace-dir>.backup/ <workspace-dir>/` then
   `jj commit -m "msg"`, then clean up: `rm -rf <workspace-dir>.backup`.
