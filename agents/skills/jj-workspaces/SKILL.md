---
name: jj-workspaces
description: "Use when you want to work in an isolated jj working copy — parallel task, experimental scratch, subagent with its own tree. Covers creating a workspace, working inside it from anywhere, and cleaning up without losing history."
user-invocable: false
---

# jj workspaces

A workspace is a second working directory attached to the same repo. Each
workspace has its own `@` (working-copy commit), but they share the same
`.jj` store — commits you make in one appear immediately in `jj log` from
the other. Analogous to `git worktree` but through jj's abstraction.

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
# Default: shares parents with current @
jj workspace add --name NAME /abs/path/to/new-workspace

# With an explicit base revision
jj workspace add --name NAME -r <rev> /abs/path/to/new-workspace
```

Convention: put the workspace as a sibling of the repo. Repo at
`~/src/foo` → workspace at `~/src/foo-NAME/`. Keeps `jj log`'s
`<name>@` marker meaningful and avoids nesting a workspace under a path
the main repo scans.

`NAME` appears in `jj workspace list` and as `<name>@` in `jj log` from any
workspace. Pick something descriptive; you'll see it until you `forget`.

## Work inside

You don't have to `cd` into the workspace. jj accepts a repo path via
`-R`, and most tools handle absolute paths:

```bash
# Target the workspace from anywhere
jj -R /abs/path/to/workspace st
jj -R /abs/path/to/workspace log
jj -R /abs/path/to/workspace commit /abs/path/to/workspace/file.ts -m "msg"
```

Claude's Bash tool doesn't persist shell state between calls, so `cd` in
one call doesn't affect the next. For one-shot ops, `jj -R <abs-path>` is
the cheapest shape. For a concentrated stretch inside the workspace,
chain with `;` or `&&` in a single Bash call:

```bash
cd /abs/path/to/workspace && jj st && jj new -m scratch
```

## Clean up

Order: check → commit/push anything you want to keep → forget → remove dir.

```bash
# 1. Inspect. Uncommitted changes?
jj -R /abs/path/to/workspace st

# 2. Any commits reachable only from this workspace? (from main workspace)
jj log
# Look for changes under the <name>@ marker that aren't bookmarked or pushed.
# If they matter: bookmark, push, or rebase onto main before proceeding.

# 3. Detach the workspace from the repo's workspace list.
jj -R /path/to/main/repo workspace forget NAME

# 4. Remove the directory.
rm -rf /abs/path/to/workspace
```

`workspace forget` doesn't touch the filesystem — it only releases the
working-copy commit from the repo's tracking. After that, commits only
reachable from the forgotten `@` become eligible for GC eventually, so
bookmark or push anything you want to keep *before* forgetting.

The "I committed everything, just prune" happy path:

```bash
jj -R /abs/path/to/workspace st            # verify clean
jj -R /path/to/main/repo workspace forget NAME
rm -rf /abs/path/to/workspace
```

## Common mistakes

- **`rm -rf` without `workspace forget`** — main repo keeps a dead entry
  in `jj workspace list`. Not data loss, just noise. Fix with
  `jj workspace forget NAME` after the fact.
- **Forgetting before checking `jj log`** — reachable-only commits can be
  GC'd. Always inspect first; bookmark or push anything worth keeping.
- **Relative path to `-R`** — resolved against cwd, not the workspace.
  Use absolute paths when targeting a non-current workspace.
- **Editing in the workspace while the main checkout is also open on
  overlapping files** — jj snapshots each workspace's `@` independently,
  but two workspaces editing the same path and both committing can leave
  the repo with two divergent heads. Not broken, just confusing; prefer
  one active workspace per logical task.
