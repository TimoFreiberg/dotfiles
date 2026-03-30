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
  - Agent
  - Read
  - Glob
  - Grep
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

## Step 3: Load review guidelines

Check if `REVIEW_GUIDELINES.md` exists in the project root. If so, read it. Otherwise read [review-guidelines.md](../../references/review-guidelines.md). These guidelines are used in the subagent prompts below.

## Step 4: Launch parallel review agents

Launch **three** Agent subagents in parallel (all in a single message so they run concurrently). Each agent receives:
- The full diff from Step 2
- Any PR context (title, description, comments) if this is a PR review
- Any custom instructions from `$ARGUMENTS`
- Its axis-specific guidelines (below)
- The project's review guidelines from Step 3

Each agent should use Read, Glob, and Grep to examine source files for context beyond the diff. Instruct each agent to return findings in the format specified in the review guidelines, but with axis-prefixed numbering.

### Agent 1: Correctness & Security (prefix: C)

Focus exclusively on:
- Logic bugs, off-by-one errors, incorrect control flow
- All vulnerability classes from the review guidelines (memory safety, integer issues, untrusted input, concurrency, resource leaks)
- Error handling: unchecked errors, wrong error codes, logging-and-continue
- Fail-fast violations, silent degradation
- Incorrect assumptions about inputs, state, or ordering

Ignore documentation, naming, and structural concerns — other agents cover those.

Number findings C1, C2, C3, …

### Agent 2: Documentation & Comments (prefix: D)

Focus exclusively on:
- Comments that restate what the code visibly does (review guideline #6)
- Comments that are inaccurate, outdated, or misleading relative to the code (review guideline #7)
- Doc comments / module-level docs that make claims not supported by the code — cross-reference every factual claim against actual code paths
- Missing documentation where the *why* is non-obvious
- Commit message / PR description accuracy relative to what the diff actually does

Read the full source files (not just the diff) to verify doc claims. Ignore correctness and structural concerns — other agents cover those.

Number findings D1, D2, D3, …

### Agent 3: Design & Structure (prefix: S)

Focus exclusively on:
- New dependencies: are they justified? (review guideline #1)
- Unnecessary abstractions, wrappers, or indirection (review guideline #2)
- API design: are interfaces clear, minimal, hard to misuse?
- Code organization: does the change belong where it's placed?
- Naming: do names accurately reflect behavior?
- Consistency with surrounding code patterns

Ignore correctness bugs and documentation — other agents cover those.

Number findings S1, S2, S3, …

## Step 5: Collate and present findings

Once all three agents return:

1. Collect all findings, keeping the axis prefix (C/D/S numbering).
2. Sort by priority (P0 first, then P1, P2, P3).
3. Deduplicate: if two agents flagged the same issue from different angles, merge into one finding, keep the higher priority, and note both perspectives.
4. Present the combined review in a single response using the standard findings format from the review guidelines.
5. End with the overall verdict: "correct" or "needs attention" based on whether any P0/P1 findings exist across all axes.

