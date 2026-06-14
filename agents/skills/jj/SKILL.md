---
name: jj
description: "Use when committing, rebasing, inspecting history, or fixing repo state with jj (Jujutsu) — including colocated .git/.jj repos and detached-HEAD confusion. Flags interactive commands that hang agents."
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
and `origin/main` refs can be stale. Two common safety signals then lie:

- `git branch -d <branch>` failing with "not fully merged"
- `git diff main..<branch>` showing the branch as still *adding* content

Both can be artifacts of stale local refs, not real unmerged work — especially
under **squash-merge**, where a merged branch is never an ancestor of `main`
even after its content fully landed.

Before deleting, refresh first: `jj git fetch` (or compare against an
authoritative source — `gh api repos/<owner>/<repo>/commits/main`, a deployed
tree). Then `git diff origin/main..<branch>` going empty confirms the content
landed and the branch is safe to drop. If you can't fetch (permissions),
triangulate against the authoritative source instead of trusting local refs.

Recovery if wrong: the deleted branch's commit SHA is recoverable via
`git reflog` (or terminal scrollback).

## Undoing Operations

If a command puts the wrong changes into the wrong commit (e.g. squash into the wrong parent), **don't try to manually fix the commits** — revert the operation instead:

1. Check the commit log: `jj log`
2. Check the operation log: `jj op log`
3. Revert the bad operation: `jj op revert <op_id>` (the op ID is shown in `jj op log`)

`jj op revert` undoes one operation; `jj op restore <op_id>` resets the whole repo to the state as of that operation (undoing everything after it).
