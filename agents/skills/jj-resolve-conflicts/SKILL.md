---
name: jj-resolve-conflicts
description: "Resolve jj (Jujutsu) conflicts. Use when jj log/status shows conflicted revisions, a rebase/squash/abandon reports 'new conflicts appeared', or files contain jj conflict markers."
argument-hint: "[<change-id>]"
---

# Resolve jj Conflicts

Resolve the earliest conflicted revision first; descendants rebase automatically
and their conflicts may disappear. Use jj throughout, not mutating Git commands:
jj conflicts are not ordinary Git index conflicts.

## 1. Find the conflicted revision

Use the requested change ID when supplied. Otherwise:

```bash
jj log --no-pager -r 'roots(conflicts())'
```

Before `jj new`, check whether the **whole commit is obsolete**, including its
non-conflicting changes. If its entire intended effect is already present or
explicitly superseded, use `jj abandon <change-id>` instead of resolving files.
One redundant hunk or a difficult merge is not enough; ask the user if discarding
the intent requires a product decision. If a resolution child already exists,
inspect and account for its edits before abandoning the parent.

Abandoning rebases descendants and can introduce conflicts. Recheck
`roots(conflicts())`, resolve any remaining conflicts, and verify the resulting
behavior with relevant project checks before finishing.

If the commit is still needed and `@` is that revision, resolve it in place and
skip the squash step. Otherwise create a resolution change on top of it:

```bash
jj new <change-id>
jj resolve --list
```

## 2. Choose the resolution method

Inspect all sides and the surrounding source before choosing:

| Intended result | Method |
|---|---|
| Entire file equals conflict side #1 or #2 | `jj resolve --tool :ours -- <path>` or `jj resolve --tool :theirs -- <path>` |
| Entire file equals a known revision | `jj restore --from <revision> -- <path>` |
| Select or combine content within conflict regions | `jcw`, below |

`:ours` and `:theirs` select **whole files**, not just conflicting hunks. Verify
side identities and whole-file differences first; unrelated changes from the
other side can be lost. Do not infer sides from branch names. Check
`jj resolve --help` for installed support; the built-ins handle two-sided
conflicts. Never run bare `jj resolve`, which launches an interactive tool.
`jj resolve --list` is safe for listing conflicts.

For equivalent changes, choose one implementation. Combine orthogonal changes;
ask the user about contradictory intent. If a side's purpose is unclear, inspect
`jj diff --no-pager --git -r <change-id>`.

After whole-file selection, review `jj diff --no-pager --git` and proceed to
verification. If region-level work needs `jcw` and it is unavailable, use
[direct-marker-editing.md](direct-marker-editing.md).

## 3. Resolve regions with jcw

Finish one file's prepare–edit–preview–apply cycle before preparing another:

```bash
jcw prepare --file <path>
```

The first output line is the workspace path. Read its complete `resolved` file
and every `term-*.term` file listed beside each numbered
`JCW-UNRESOLVED-CONFLICT-REGION-NNN` placeholder. Terms may be fragments, not
complete declarations; account for source already preserved around them.

Replace only placeholder lines with final source, or delete them for an empty
resolution. Preserve everything else byte-for-byte. Do not edit the original
source or format the proposal while the workspace is active.

```bash
jcw apply --resolved-file <workspace>/resolved
```

Inspect the complete preview and rendered source for duplicated or missing
structure. Only after validation succeeds and the proposal is correct, install:

```bash
jcw apply --resolved-file <workspace>/resolved --write
```

Reread the changed range. The workspace is now finished. Make any necessary
adjacent integration edits separately and review their diff; verify the combined
result before squashing. This is not permission to bypass a rejected proposal.

### If validation fails

- **Outside-region guard:** compare against the untouched prepared template,
  restore altered context, and redo only placeholder replacements. If needed,
  prepare unchanged source into a fresh workspace to recover that template;
  repeating the same broad edits will fail again.
- **Stale source:** inspect what changed before preparing a fresh workspace;
  do not overwrite newer work with the old proposal.
- **Minimal compliant replacement still fails:** preserve the workspace and
  diagnose the tool or report the blocker. Do not loop through fresh workspaces
  or install the rejected proposal directly.

## 4. Verify

Resolve every listed file, then run the project's formatter/parser and relevant
tests, including any adjacent integration edits. Review the complete diff:

```bash
jj diff --no-pager --git
jj resolve --list
jj st --no-pager
```

No unresolved files may remain in the working copy. In the `jj new` workflow,
status should report that the parent conflict was resolved in the working copy.

## 5. Squash and repeat

Skip squash if the conflicted revision was already `@`. Otherwise:

```bash
jj squash --use-destination-message --no-pager
```

Always pass the message flag; it avoids an editor regardless of descriptions.
Check for remaining descendant conflicts:

```bash
jj log --no-pager -r 'conflicts()'
```

Repeat from the earliest remaining conflict, then run full relevant project
checks. A conflict-free tree can still be semantically wrong. For a botched
history rewrite, consult the [jj skill](../jj/SKILL.md) before recovery.
