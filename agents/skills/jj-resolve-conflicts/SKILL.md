---
name: jj-resolve-conflicts
description: "Resolve jj (Jujutsu) conflicts. Use when jj log/status shows conflicted revisions, a rebase/squash/abandon reports 'new conflicts appeared', or files contain jj conflict markers."
argument-hint: "[<change-id>]"
---

# Resolve jj Conflicts

Resolve the earliest conflicted revision with `jcw`, verify the result, and
squash the resolution into that revision.

## Core idea

jj records conflicts inside commits rather than stopping a rebase halfway.
Resolve the earliest conflicted commit first: descendants rebase automatically
and their conflicts often disappear.

Use `jcw` to replace native marker regions with stable placeholders, inspect
each conflict term, and install only a validated resolution. Never run bare
`jj resolve`; it launches an interactive merge tool. `jj resolve --list` is
safe and read-only.

`jcw` is required. If it is unavailable, read
[direct-marker-editing.md](direct-marker-editing.md) instead.

## 1. Find the earliest conflicted revision

Use the requested change ID when one was supplied. Otherwise run:

```bash
jj log --no-pager -r 'roots(conflicts())'
```

If `@` is that revision, resolve it in place and skip the squash step. Otherwise
create an undescribed resolution change on top of it:

```bash
jj new <change-id>
jj resolve --list
```

## 2. Prepare each conflicted file

Run one command at a time:

```bash
jcw prepare --file <path>
```

The first output line is the workspace path. Read the complete
`<workspace>/resolved` file for source context, then read every `term-*.term`
file listed beside its `JCW-UNRESOLVED-CONFLICT-REGION-NNN` placeholder. Do not
edit the original source while the workspace is active.

Determine the intent of all terms before editing:

- **Same intent:** choose the better implementation; do not combine duplicates.
- **Orthogonal changes:** merge both, adapting additions to structural changes.
- **Contradictory changes:** ask the user which behavior to keep.

When labels do not make a side's purpose clear, inspect its revision:

```bash
jj diff --no-pager --git -r <change-id>
```

## 3. Write and apply the resolution

In `<workspace>/resolved`, replace every numbered placeholder line with the
final source for that region, or delete it when the resolution is empty. For a
multi-sided conflict, write one coherent result rather than concatenating
terms.

Preview the validated change:

```bash
jcw apply --resolved-file <workspace>/resolved
```

Inspect the complete diff. If it is wrong, edit `resolved` and preview again.
Do not bypass a validation failure by editing the source directly.

Install only the reviewed proposal:

```bash
jcw apply --resolved-file <workspace>/resolved --write
```

Reread the changed source range. Repeat prepare/apply for every file reported by
`jj resolve --list`.

## 4. Verify before rewriting history

Run the project's formatter or parser, then its relevant tests. Also run:

```bash
jj resolve --list
jj st --no-pager
```

`jj resolve --list` must report no unresolved files. In the `jj new` workflow,
`jj st` should say that the parent conflict was resolved in the working copy.

## 5. Squash the resolution

Skip this step when the conflicted revision was already `@`. Otherwise:

```bash
jj squash --no-pager
```

Bare squash is non-interactive only because the resolution change is
undescribed. If it acquired a description, use `jj squash -u` instead.
Expect jj to report that conflicts were resolved or abandoned from descendant
commits.

## 6. Repeat

```bash
jj log --no-pager -r 'conflicts()'
```

If conflicts remain, repeat from the new earliest conflict. Once none remain,
run the full relevant project checks. A mechanically valid resolution can still
be semantically wrong.

## Common mistakes

- **Resolving a descendant first:** fix `roots(conflicts())` first.
- **Editing the source after `jcw prepare`:** this makes the workspace stale;
  edit only its `resolved` file.
- **Skipping the dry run:** inspect `jcw apply` output before adding `--write`.
- **Treating validation failure as permission to bypass `jcw`:** correct the
  workspace or input instead.
- **Describing the resolution change before bare squash:** use `jj squash -u`.
- **Repairing a botched history rewrite manually:** use `jj undo` and consult
  the [jj skill](../jj/SKILL.md).
