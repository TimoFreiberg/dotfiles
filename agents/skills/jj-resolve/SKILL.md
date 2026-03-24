---
name: jj-resolve
description: "Resolve jj (Jujutsu) conflicts. Use when jj log/status shows conflicted revisions."
argument-hint: "[<change-id>]"
---

# Resolve jj Conflicts

Resolve conflicts in jj revisions by understanding the intent of both sides, then
writing the merged result and squashing into the conflicted commit.

## Step 1: Identify conflicted revision

If `$ARGUMENTS` contains a change ID, use that. Otherwise find conflicts:

```bash
jj log --no-pager -r 'conflicts()'
```

If multiple conflicts exist, start with the earliest ancestor (topologically first) —
resolving a parent often auto-resolves descendants.

## Step 2: Examine the conflict

Show the full conflict diff:

```bash
jj show <change-id> --no-pager
```

This shows conflict markers in the format:

```
<<<<<<< conflict N of M
+++++++ <side-a info>
<side A content>
%%%%%%% <diff description>
\\\\\\\        to: <side B info>
 <context>
+<added by side B>
-<removed by side B>
>>>>>>> conflict N of M ends
```

Or the alternate form where `%%%%%%%` (a diff) comes first and `+++++++` (snapshot) second.

**Read both descriptions** in the conflict markers — they name the commits/changes
involved and explain what each side intended.

## Step 3: Understand both sides

For each conflict:

1. **Identify the upstream change**: The rebase destination or the change being rebased onto.
2. **Identify the local change**: The rebased revision (your change).
3. **Determine if they conflict logically** or just textually:
   - **Same intent** (both fix the same bug differently): Pick the better one, or drop yours if upstream's is merged.
   - **Orthogonal changes** (touching the same lines for different reasons): Merge both — take upstream's structural changes and integrate your additions.
   - **Contradictory changes**: Flag to the user and ask which direction to go.

When unsure about a change's purpose, examine it in isolation:

```bash
jj diff --no-pager --git -r <change-id>
```

Or look at the upstream commit directly:

```bash
git show <commit-hash> -- <file-path>
```

## Step 4: Read the full conflicted file

**Always** read the full file before editing — the conflict markers are inline and
you need the surrounding context:

```
read packages/foo/src/bar.ts
```

## Step 5: Write the resolved file

Write the complete resolved file (no conflict markers). When merging orthogonal changes:

- Take upstream's structural refactors (renames, new abstractions, new methods)
- Integrate your additions into the new structure
- Use upstream's new helpers/patterns where applicable (e.g., if upstream added
  `notifyBranchChange()`, use it instead of manually iterating callbacks)

## Step 6: Verify and squash

Check the resolution resolved the conflict:

```bash
jj status --no-pager
```

Should show: `Hint: Conflict in parent commit has been resolved in working copy`

Squash the resolution into the conflicted commit:

```bash
jj squash --no-pager
```

Check if descendant conflicts were also resolved:

```bash
jj log --no-pager -r 'conflicts()'
```

If descendants still have conflicts, repeat from Step 2 for the next one.

## Step 7: Run checks

After all conflicts are resolved, run the project's check command if available
(e.g., `npm run check`) to verify the merged code compiles and passes lint.
