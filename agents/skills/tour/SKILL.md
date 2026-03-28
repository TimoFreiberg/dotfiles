---
name: tour
description: "Guided walkthrough of code changes — what changed, key decisions, and areas deserving scrutiny."
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
  - Read
  - Grep
  - Glob
---

## Repo state

- VCS: !`test -d .jj && echo "jj" || echo "git"`
- Uncommitted changes: !`test -d .jj && jj diff --stat 2>/dev/null || git diff --stat HEAD 2>/dev/null`
- Current branch: !`test -d .jj && jj log -r @ --no-graph -T 'bookmarks' 2>/dev/null || git branch --show-current 2>/dev/null`
- Recent commits: !`test -d .jj && jj log --no-graph -r 'ancestors(@, 5)' -T 'change_id.shortest() ++ " " ++ description.first_line() ++ "\n"' 2>/dev/null || git log --oneline -5 2>/dev/null`

## Step 1: Determine scope

| Argument | Action |
|---|---|
| *(empty)* | Use AskUserQuestion; use repo state above to tailor options |
| `uncommitted` | Tour uncommitted changes |
| `commit <hash>` | Tour that commit |
| `pr <number-or-url>` | Tour that GitHub PR |
| `branch <name>` | Tour changes against that base branch |
| `file <path>` | Tour only that file's changes |

When empty, use AskUserQuestion. Show smart options based on repo state (hide "uncommitted" if clean, etc.).

When the user picks "commit", show recent commits and ask which. For "PR", ask for the number. For "branch", show branches and ask which.

## Step 2: Gather the diff and context

Use jj commands if VCS is "jj", git commands otherwise.

| Scope | git | jj |
|---|---|---|
| uncommitted | `git diff HEAD` | `jj diff --git` |
| commit | `git show <hash>` | `jj diff --git -r <change-id>` |
| pr | `gh pr diff <n>` + `gh pr view <n>` + `gh pr view <n> --comments` | same |
| branch | `git diff $(git merge-base HEAD <branch>)` | `jj diff --git -r 'latest(trunk())..@'` |
| file | `git diff HEAD -- <path>` | `jj diff --git <path>` |

For PR tours, also fetch the PR title/description and reviewer comments for context.

## Step 3: Build the tour

Read source files as needed for context around changes. Then present the tour in this structure:

### Part 1: Overview (always show)

A 2-4 sentence summary of what this changeset does and why. State the goal, not just the mechanics.

### Part 2: File-by-file walkthrough

For each changed file (or logical group of related files), provide:

1. **What changed**: One-line summary of the modification.
2. **Why it matters**: How this fits into the overall goal. Skip for trivial changes (imports, formatting).
3. **Key details**: Call out specific lines/patterns worth understanding — new APIs, algorithm choices, data flow changes, configuration changes. Reference specific line numbers.

Order files by narrative flow (entry points first, then dependencies), not alphabetically.

### Part 3: Decisions and tradeoffs

List notable design decisions visible in the diff:
- Why was approach X chosen over alternatives?
- What tradeoffs were made? (performance vs readability, duplication vs abstraction, etc.)
- Are there implicit assumptions?

Only include this section if there are genuine decisions to highlight. Don't fabricate tradeoffs.

### Part 4: Areas deserving scrutiny

Flag specific areas that a reviewer should look at carefully:
- Complex logic that's easy to get wrong
- Security-sensitive code (input handling, auth, crypto, shell commands)
- Error handling gaps or unusual control flow
- Subtle behavioral changes that might not be obvious from the diff
- Missing test coverage for new logic
- Potential edge cases

For each area, reference the specific file and line range, and explain *what* to look for.

**Do NOT turn this into a code review.** The goal is to direct attention, not to judge. Use language like "worth verifying that..." or "this assumes..." rather than "this is wrong."

### Part 5: Questions for the author

If the diff leaves open questions that would help a reviewer understand intent, list them. Examples:
- "Is the fallback on line 42 intentional, or a placeholder?"
- "Should this new endpoint have rate limiting?"

Skip this section if no genuine questions arise.

## Presentation style

- Use a conversational but direct tone — like a knowledgeable colleague walking you through their PR.
- Reference specific files and line numbers throughout.
- Use code snippets (under 5 lines each) only when they clarify something the prose can't.
- Bold key terms and file names for scannability.
- Don't repeat information across sections — each section adds new perspective.
- Keep the total tour concise. A 50-line diff doesn't need a 500-line tour.
