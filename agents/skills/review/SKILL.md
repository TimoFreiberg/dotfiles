---
name: review
description: Code review with scope selection. Use when the user wants to review code changes - uncommitted work, a specific commit, or a GitHub PR.
argument-hint: "[uncommitted | commit <hash> | pr <number> | branch <name>]"
disable-model-invocation: true
allowed-tools:
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git show *)
  - Bash(git merge-base *)
  - Bash(git status *)
  - Bash(git branch *)
  - Bash(git rev-parse *)
  - Bash(gh pr diff *)
  - Bash(gh pr view *)
  - Bash(jj *)
---

# Code Review

## Step 1: Determine review scope

Parse `$ARGUMENTS` to determine what to review:

| Argument | Example | Action |
|---|---|---|
| *(empty)* | `/review` | Ask the user (see below) |
| `uncommitted` | `/review uncommitted` | Review uncommitted changes |
| `commit <hash>` | `/review commit abc123` | Review that commit |
| `pr <number-or-url>` | `/review pr 42` | Review that GitHub PR |
| `branch <name>` | `/review branch main` | Review changes against that base branch |
| anything else | `/review check for XSS` | Use as custom review instructions |

**When `$ARGUMENTS` is empty**, use AskUserQuestion to ask the user which scope they want. Present these options:

- **Uncommitted changes** - staged, unstaged, and untracked files
- **A specific commit** - review a single commit
- **A GitHub PR** - review a pull request by number
- **Against a base branch** - compare current branch to a base

If the user picks "commit", run `git log --oneline -10` and show the results, then ask which commit. If they pick "PR", ask for the PR number. If they pick "branch", run `git branch --format='%(refname:short)'` and ask which branch.

## Step 2: Gather the diff

Based on the scope, fetch the diff:

- **uncommitted**: `git diff HEAD` (includes staged + unstaged). Also check `git status` for untracked files and read any new files.
- **commit**: `git show <hash>`
- **pr**: `gh pr diff <number>` for the diff, `gh pr view <number>` for title/description.
- **branch**: Find merge base with `git merge-base HEAD <branch>`, then `git diff <merge-base>`.

## Step 3: Delegate review to a subagent

Use the **Task tool** with `subagent_type: "general-purpose"` to perform the actual review. Pass the subagent:

1. The full diff content
2. The review guidelines (see below)
3. Instructions to read any files it needs for additional context

The subagent prompt should be structured as:

```
<review-guidelines>
{guidelines from Step 4}
</review-guidelines>

<diff>
{the diff content}
</diff>

Review the above diff following the guidelines. Read source files as needed for context.
For PR reviews, also consider the PR title and description for intent.
```

## Step 4: Review guidelines

First, check if a `REVIEW_GUIDELINES.md` file exists in the project root (same directory as `.claude/` or the git root). If it exists, use its contents as the review guidelines.

If no project-level guidelines exist, use these defaults:

---

You are reviewing code changes made by another engineer.

### What to flag

Flag issues that:
1. Meaningfully impact correctness, performance, security, or maintainability.
2. Are discrete and actionable - one issue per finding, not vague concerns.
3. Don't demand rigor inconsistent with the rest of the codebase.
4. Were introduced in the changes being reviewed, not pre-existing problems.
5. The author would likely fix if aware of them.
6. Have provable impact on other parts of the code - don't speculate that a change may break something, identify the parts that are actually affected.
7. Are clearly not intentional changes by the author.

### Review priorities

1. Call out newly added dependencies and explain why they're needed.
2. Prefer simple, direct solutions over wrappers or abstractions without clear value.
3. Favor fail-fast behavior; avoid logging-and-continue patterns that hide errors.
4. Prefer predictable behavior; crashing is better than silent degradation.
5. Ensure errors are checked against codes or stable identifiers, never error messages.
6. Be careful with untrusted user input: flag unparameterized SQL, open redirects, and unprotected fetches of user-supplied URLs.

### Findings format

Tag each finding with a priority level:
- **[P0]** - Drop everything. Blocking. Only for universal issues that don't depend on assumptions about inputs.
- **[P1]** - Urgent. Should be addressed in the next cycle.
- **[P2]** - Normal. Fix eventually.
- **[P3]** - Low. Nice to have.

For each finding, include the priority tag, file path with line number, and a brief explanation (one paragraph max). Use a matter-of-fact tone.

Findings must reference locations that overlap with the actual diff. Ignore trivial style issues unless they obscure meaning. Don't stop at the first finding - list every qualifying issue.

---

## Step 5: Present findings

After the subagent returns, present its findings directly. Don't re-summarize or editorialize. End with the overall verdict:

- **Correct** - no blocking issues (no P0/P1 findings)
- **Needs attention** - has P0 or P1 issues

If there are no qualifying findings, say the code looks good.
