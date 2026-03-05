---
name: jj
description: "Version control with jj (Jujutsu)"
---

# jj Command Reference

See [reference.md](reference.md) for advanced commands (rewriting history, conflicts, remotes, revsets).

## Key Concepts

- **Working copy (`@`)**: The current change, automatically tracks file modifications.
- **Changes vs commits**: A change has a stable _change ID_ (short, letters only); a commit has a _commit ID_ (hex). Prefer change IDs in commands.
- **Immutable revisions**: Commits on bookmarked/tagged/remote branches are immutable by default. Use `jj new` to create a mutable change on top.

## Inspecting State

| Command | Purpose |
|---|---|
| `jj status` | Show working copy status (modified/added/removed files) |
| `jj diff --git` | Diff of working copy vs parent |
| `jj diff --git -r <rev>` | Diff of a specific revision |
| `jj show <rev>` | Show a specific revision (diff + description) |
| `jj log` | Show revision graph |
| `jj log -r <revset>` | Show filtered revision graph |

## Creating and Committing Changes

| Command | Purpose |
|---|---|
| `jj new` | Create a new empty change on top of `@` |
| `jj new <rev>` | Create a new change on top of `<rev>` |
| `jj commit -m "msg"` | Finalize `@` with a description, start a new empty change |
| `jj commit <paths...> -m "msg"` | Commit only specific files |
| `jj describe -m "msg"` | Set/update description of `@` without creating a new change |
| `jj describe -m "msg" -r <rev>` | Set/update description of another revision |

## Squashing

| Command | Purpose |
|---|---|
| `jj squash --use-destination-message` | Squash `@` into its parent, keeping parent's message |
| `jj squash -m "msg"` | Squash `@` into its parent with an explicit message |

**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message`. Bare `jj squash` opens an interactive editor and will hang.

## Bookmarks

| Command | Purpose |
|---|---|
| `jj bookmark set <name> -r <rev>` | Create or move a bookmark to a revision |
