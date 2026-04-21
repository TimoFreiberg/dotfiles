---
name: jj
description: "Version control with jj (Jujutsu)"
---

# jj Command Reference

For flags and syntax details, run `jj <subcommand> --help`.

See [reference.md](reference.md) for advanced topics (rewriting history, splitting commits, revsets).

## Key Concepts

- **Working copy (`@`)**: The current change, automatically tracks file modifications.
- **Changes vs commits**: A change has a stable _change ID_ (short, letters only); a commit has a _commit ID_ (hex). Prefer change IDs in commands.
- **Immutable revisions**: Commits on bookmarked/tagged/remote branches are immutable by default. Use `jj new` to create a mutable change on top.

## Squashing

**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message`. Bare `jj squash` opens an interactive editor and will hang.

## Splitting Commits

Do **not** use `jj split` — it is interactive and will hang. See the
[agent-friendly splitting methods](reference.md#splitting-commits-agent-friendly)
in the advanced reference.

## File Tracking

`jj file untrack <paths>` stops tracking paths in the working copy. Paths must already be in `.gitignore`. Useful when files were accidentally committed before being ignored.

## Undoing Operations

If a command puts the wrong changes into the wrong commit (e.g. squash into the wrong parent), **don't try to manually fix the commits** — revert the operation instead:

1. Check the commit log: `jj log`
2. Check the operation log: `jj op log`
3. Revert the bad operation: `jj op revert <op_id>` (the op ID is shown in `jj op log`)
