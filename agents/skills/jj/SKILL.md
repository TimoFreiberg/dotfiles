---
name: jj
description: "Use when committing, rebasing, inspecting history, or fixing repo state with jj (Jujutsu) — including colocated .git/.jj repos, detached-HEAD confusion, and stale-workspace recovery. Flags interactive commands that hang agents."
---

For syntax, run `jj <subcommand> --help`.

**Never open an editor or TUI.** Pass `-m` to `jj describe`, `jj commit` and
`jj squash` (or `--use-destination-message` for squash). Never run `jj split`,
`jj diffedit`, or bare `jj resolve`. To split a commit, either
`jj duplicate <rev> --onto <rev>-`, trim the duplicate, then
`jj rebase -s <rev> -d <duplicate>`; or `jj new <rev>-`,
`jj restore --from <rev> <paths>`, then `jj rebase -s <rev> -d @`. Either way
jj drops the moved changes from the original.

Colocated repos: a detached git HEAD is normal. Don't fix it, and don't
change state through git; read-only git commands are fine.

Other repos: use `jj -R <abs-path>`; `cd` doesn't persist between tool
calls. Bare `jj` shows the in-progress graph; `jj log -r '<rev>::'` shows
everything under a commit.

Undo, don't hand-repair. Find the bad operation in `jj op log`, then
`jj op revert <op-id>`, or `jj op restore <op-id>` to return to that state.

Before deleting a branch, `jj git fetch`, then check that
`jj diff --from main@origin --to <bookmark>` is empty. Local refs may be
stale, and after a squash-merge the branch is never an ancestor of main.

Stale workspace (another workspace rewrote this one's `@`): run
`jj workspace update-stale` before anything else; other commands are blocked.
If someone else is editing files here, stop and ask the operator. Then check
`jj log`:
- divergent `@` (`??`): your edits are in the other commit;
  `jj restore --from <other> --into @ <paths>`, then `jj abandon <other>`.
- `RECOVERY COMMIT FROM jj workspace update-stale`: it holds the old state.
- still missing: `jj --at-op=<op-before-update-stale> log` and
  `jj file show -r <rev> <path>`.
