# jj Advanced Reference

## Rewriting History

| Command | Purpose |
|---|---|
| `jj squash -r <rev> --use-destination-message` | Squash `<rev>` into its parent, keeping parent's message |
| `jj squash --from <a> --into <b> -m "msg"` | Move changes from one revision into another |
| `jj split -r <rev>` | Interactively split a revision into two |
| `jj edit <rev>` | Set working copy to an existing change for editing |
| `jj abandon <rev>` | Discard a change entirely |
| `jj new <a> <b>` | Create a merge change with multiple parents |
| `jj diff --from <a> --to <b>` | Diff between two revisions |

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
