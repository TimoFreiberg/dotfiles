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

## Step 3: Perform the review

Conduct this review adversarially. Load the review guidelines (see Step 4), then review the diff inline. Read source files as needed for context. For PR reviews, also consider the PR title, description, and comment thread for intent.

## Step 4: Review guidelines

Check if `REVIEW_GUIDELINES.md` exists in the project root. If so, use it. Otherwise read [review-guidelines.md](../../references/review-guidelines.md) and use those guidelines.

