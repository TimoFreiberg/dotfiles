---
name: jj-resolve-conflicts
description: "Resolve jj (Jujutsu) conflicts. Use when jj log/status shows conflicted revisions, a rebase/squash/abandon reports 'new conflicts appeared', or files contain jj conflict markers."
---

Resolve the earliest conflicted revision first (the given change ID, or
`jj log -r 'roots(conflicts())'`); descendants rebase automatically and often
resolve with it. If the whole commit is already obsolete, `jj abandon` it
instead, and ask when dropping its intent is a product decision.

If `@` is the conflicted revision, resolve in place. Otherwise `jj new <rev>`,
resolve, then `jj squash --use-destination-message`. `jj resolve --list` shows
conflicted files; never run bare `jj resolve`.

Read every side before choosing: keep one of two equivalent changes, combine
orthogonal ones, and ask about contradictory ones. `jj diff --git -r <rev>`
shows what a side intended.

- Whole file from one side: `jj resolve --tool :ours|:theirs -- <path>` or
  `jj restore --from <rev> -- <path>`. Both replace the entire file, not just
  the conflicting hunks, so check the sides first.
- Otherwise edit the markers directly; saving the file is the resolution.
  Markers are git-style (snapshot-style for more than two sides).

Then review `jj diff --git`, run the formatter and relevant tests (an
intermediate commit may fail to build for unrelated reasons), confirm `jj st`
shows no conflicts, squash if needed, and repeat until
`jj log -r 'conflicts()'` is empty.
