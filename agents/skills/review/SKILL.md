---
name: review
description: Code review with scope selection. Use when the user wants to review code changes - uncommitted work, a specific commit, or a GitHub PR.
argument-hint: "[uncommitted | commit <hash> | pr <number> | branch <name> | file <path>]"
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

## Repo state

- VCS: !`test -d .jj && echo "jj" || echo "git"`
- Uncommitted changes: !`test -d .jj && jj diff --stat 2>/dev/null || git diff --stat HEAD 2>/dev/null`
- Current branch: !`test -d .jj && jj log -r @ --no-graph -T 'bookmarks' 2>/dev/null || git branch --show-current 2>/dev/null`
- Recent commits: !`test -d .jj && jj log --no-graph -r 'ancestors(@, 5)' -T 'change_id.shortest() ++ " " ++ description.first_line() ++ "\n"' 2>/dev/null || git log --oneline -5 2>/dev/null`

## Step 1: Determine review scope

| Argument | Example | Action |
|---|---|---|
| *(empty)* | `/review` | Use AskUserQuestion; use repo state above to tailor options |
| `uncommitted` | `/review uncommitted` | Review uncommitted changes |
| `commit <hash>` | `/review commit abc123` | Review that commit |
| `pr <number-or-url>` | `/review pr 42` | Review that GitHub PR |
| `branch <name>` | `/review branch main` | Review changes against that base branch |
| `file <path>` | `/review file src/foo.ts` | Review only that file's uncommitted changes |
| anything else | `/review check for XSS` | Use as custom review instructions |

When `$ARGUMENTS` is empty, use AskUserQuestion. Use the repo state above to make smart choices: hide "uncommitted" if working tree is clean, show the current branch name in the "branch" option description, etc.

When the user picks "commit", show recent commits and ask which. For "PR", ask for the number. For "branch", show branches and ask which.

## Step 2: Gather the diff

Use jj commands if VCS is "jj", git commands otherwise.

| Scope | git | jj |
|---|---|---|
| uncommitted | `git diff HEAD` + `git status` for untracked | `jj diff --git` |
| commit | `git show <hash>` | `jj diff --git -r <change-id>` |
| pr | `gh pr diff <n>` + `gh pr view <n>` + `gh pr view <n> --comments` | same (PRs are git-hosted) |
| branch | `git merge-base HEAD <branch>`, then `git diff <base>` | `jj diff --git -r 'latest(trunk())..@'` (adjust base as needed) |
| file | `git diff HEAD -- <path>` | `jj diff --git <path>` |

For PR reviews, also fetch `gh pr view <n> --comments` for reviewer discussion context.

## Step 3: Delegate review to a subagent

Use the **Task tool** with `subagent_type: "general-purpose"`. Structure the prompt as:

```
<review-guidelines>
{guidelines from Step 4}
</review-guidelines>

<diff>
{the diff content}
</diff>

Review the diff following the guidelines. Read source files as needed for context.
For PR reviews, also consider the PR title, description, and comment thread for intent.
```

Present the subagent's findings directly. Don't re-summarize or editorialize.

## Step 4: Review guidelines

Check if `REVIEW_GUIDELINES.md` exists in the project root. If so, use it. Otherwise use these defaults:

---

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
- **[P0]** - Blocking. Only for universal issues that don't depend on assumptions about inputs.
- **[P1]** - Urgent. Should be addressed in the next cycle.
- **[P2]** - Normal. Fix eventually.
- **[P3]** - Low. Nice to have.

For each finding: priority tag, file path with line number, brief explanation (one paragraph max). Matter-of-fact tone.

Findings must reference locations that overlap with the actual diff. Ignore trivial style issues unless they obscure meaning. List every qualifying issue.

End with verdict: **correct** (no P0/P1) or **needs attention** (has P0/P1). If no findings, say the code looks good.
