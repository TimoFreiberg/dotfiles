---
name: jj-resolve-conflicts
description: "Resolve jj (Jujutsu) conflicts. Use when jj log/status shows conflicted revisions, a rebase/squash/abandon reports 'new conflicts appeared', or files contain jj conflict markers."
argument-hint: "[<change-id>]"
---

# Resolve jj Conflicts

Resolve conflicts by understanding the intent of both sides, then editing the
conflict markers out of the file and squashing the fix into the conflicted
commit.

## Core idea

jj conflicts are not a stop-the-world state. A rebase never halts halfway:
conflicts are recorded *inside* the affected commits (shown as `×` /
`(conflict)` in `jj log`), and the markers are materialized in the working
copy when a conflicted commit is checked out. Resolving means rewriting the
conflicted commit so its tree is conflict-free — descendants rebase
automatically and their conflicts usually disappear with the parent's.

**Never run bare `jj resolve`** (with or without a file argument) — it
launches an interactive merge TUI, which errors out without a TTY and hangs
with one. The agent-friendly path is editing the markers in the file
directly; jj's snapshotting picks the resolution up. `jj resolve --list` is
fine (read-only, lists conflicted files).

## Step 1: Find the conflicted revisions

If `$ARGUMENTS` contains a change ID, use that. Otherwise:

```bash
jj log --no-pager -r 'conflicts()'
```

Start with the earliest conflicted revision — `roots(conflicts())` — since
resolving a parent often auto-resolves descendants.

## Step 2: Get the markers into the working copy

- If `@` is the earliest conflicted revision, the markers are already
  materialized in the working copy. Edit them in place; the next snapshot
  records the resolution. No squash needed — skip Step 6.
- Otherwise, create a resolution change on top of the conflicted commit
  (don't describe it — see Step 6):

```bash
jj new <change-id>
jj resolve --list   # which files are conflicted
```

## Step 3: Understand both sides

Markers look like this (sections can appear in either order; a merge of more
than two sides adds more sections):

```
<<<<<<< conflict 1 of 1
%%%%%%% diff from: voptwvkk 3ca4473a "base" (parents of rebased revision)
\\\\\\\        to: ovmtrtnw 1e713d41 "side A" (rebase destination)
-line2
+line2 changed by A
+++++++ tzytqppo a545ed55 "side B" (rebased revision)
line2 changed by B
>>>>>>> conflict 1 of 1 ends
```

The `+++++++` section is a snapshot of one side; the `%%%%%%%` section is a
diff showing what the other side changed relative to the common base. The
mechanical resolution is "apply that diff to the snapshot" — but read the
labels first: they name the commits involved and what role each played.

Then decide whether the sides conflict logically or just textually:

- **Same intent** (both fix the same bug differently): pick the better one,
  or drop yours if upstream's is already merged.
- **Orthogonal changes** (same lines, different reasons): merge both — take
  upstream's structural changes and integrate your additions into them, using
  upstream's new helpers/patterns where applicable.
- **Contradictory changes**: flag to the user and ask which direction to go.

When unsure about a side's purpose, examine it in isolation:

```bash
jj diff --no-pager --git -r <change-id>
```

## Step 4: Write the resolution

Read the **full** conflicted file first — markers are inline and you need the
surrounding context. Then write the complete resolved file with every marker
line removed. Leftover markers mean the conflict is still recorded.

## Step 5: Verify

```bash
jj st --no-pager
```

The conflict warning should be gone. In the `jj new` workflow it shows:
`Hint: Conflict in parent commit has been resolved in working copy`.

## Step 6: Squash the resolution (jj new workflow only)

```bash
jj squash --no-pager
```

Bare `jj squash` is safe *only because* the resolution change has no
description — jj keeps the destination's message silently. If the change got
described, bare squash opens an editor and hangs; use
`jj squash -u` (`--use-destination-message`) instead.

Expect `Existing conflicts were resolved or abandoned from N commits` —
descendants rebased on the fix. The working copy is left as a new empty
change on top of the fixed commit; if you were elsewhere before, return with
`jj edit <change-id>` (the empty, description-less change is abandoned
automatically).

## Step 7: Repeat and run checks

```bash
jj log --no-pager -r 'conflicts()'
```

If conflicts remain, repeat from Step 2 for the next earliest. Once clean,
run the project's check command (build/lint/tests) — a textually clean merge
can still be semantically wrong.

## Common mistakes

- **Bare `jj resolve`** — interactive merge TUI; errors without a TTY, hangs
  with one. Edit the file directly instead.
- **Resolving descendants before ancestors** — wasted work; the parent's
  resolution propagates down.
- **Describing the resolution change, then bare `jj squash`** — opens an
  editor. Use `-m` or `-u`.
- **Squashing while `jj st` still warns about conflicts** — some marker or
  file was missed; re-check `jj resolve --list`.
- **Botched squash or lost edit** — don't hand-repair the commits; `jj undo`
  and retry (see the [jj skill](../jj/SKILL.md)).
