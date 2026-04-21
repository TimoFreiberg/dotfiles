# jj Advanced Reference

## Rewriting History

| Command | Purpose |
|---|---|
| `jj squash -r <rev> --use-destination-message` | Squash `<rev>` into its parent, keeping parent's message |
| `jj squash --from <a> --into <b> -m "msg"` | Move changes from one revision into another |
| `jj split -r <rev>` | **Interactive — do not use** (hangs). See [Splitting Commits](#splitting-commits-agent-friendly) below. |
| `jj edit <rev>` | Set working copy to an existing change for editing |
| `jj abandon <rev>` | Discard a change entirely |
| `jj new <a> <b>` | Create a merge change with multiple parents |
| `jj diff --from <a> --to <b>` | Diff between two revisions |

## Splitting Commits (Agent-Friendly)

`jj split` is interactive and will hang. Use one of these approaches instead.

### Duplicate-and-trim (default — best when extracting a large portion)

Start with a full copy of the commit and remove what you don't want in the
first half:

1. **Duplicate as a sibling:**
   `jj duplicate <rev> --onto <rev>-`
   Note the new change ID from the output.
2. **Edit the duplicate and remove changes that belong in the second half:**
   `jj edit <new-change-id>`
   Use `jj restore --from <rev>- <paths...>` for whole files, or edit
   individual files for line/hunk granularity.
3. **Rebase the original (and its descendants) onto the trimmed duplicate:**
   `jj rebase -s <rev> -d <new-change-id>`
   jj deduplicates automatically — the rebased commit's diff will contain
   only the changes *not* in the duplicate.
4. **Describe both commits:**
   `jj describe -m "first half" -r <new-change-id>`
   `jj describe -m "second half" -r <rev>`

### Build-up (best when extracting a small piece)

Start empty and pull in only what you want in the first half:

1. `jj new <rev>-` — create an empty change before the commit to split.
2. `jj restore --from <rev> <paths...>` — pull in whole files, or edit files
   manually for line granularity.
3. `jj rebase -s <rev> -d @` — rebase the original onto the new commit;
   jj deduplicates the moved changes out of it.
4. Describe both commits.

## Resolving Conflicts

| Command | Purpose |
|---|---|
| `jj resolve` | Launch merge tool for conflicts in `@` |
| `jj resolve -r <rev>` | Resolve conflicts in a specific revision |
| `jj restore --from <rev> <paths...>` | Restore files from another revision |

## Bookmarks (Branches)

| Command | Purpose |
|---|---|
| `jj bookmark list` | List all bookmarks |
| `jj bookmark delete <name>` | Delete a local bookmark |
| `jj bookmark track <name>@<remote>` | Track a remote bookmark locally |
| `jj bookmark forget <name>` | Remove local bookmark without affecting remote |

## Remote Operations

| Command | Purpose |
|---|---|
| `jj git fetch` | Fetch from remotes |
| `jj git push` | Push bookmarks to remote |
| `jj git push --bookmark <name>` | Push a specific bookmark |
| `jj git push --change <rev>` | Push a change, auto-creating a bookmark |

## Undoing Mistakes

| Command | Purpose |
|---|---|
| `jj undo` | Undo the last jj operation |
| `jj op log` | Show operation history |
| `jj op restore <op-id>` | Restore repo to a previous operation state |

## Revset Expressions

| Expression | Meaning |
|---|---|
| `@` | Working copy |
| `@-` | Parent of working copy |
| `<rev>+` | Children of a revision |
| `<rev>-` | Parent of a revision |
| `<a>::<b>` | Revisions from `a` to `b` (inclusive DAG range) |
| `<a>..<b>` | Revisions in `b` not in `a` |
| `heads(<revset>)` | Heads (tips) of a set |
| `trunk()` | The trunk/main bookmark |
| `mine()` | Changes authored by you |
| `description(pattern)` | Changes matching description pattern |
| `empty()` | Empty changes |
