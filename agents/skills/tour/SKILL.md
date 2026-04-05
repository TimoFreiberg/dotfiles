---
name: tour
description: "Build a mental model of code changes — guided reading order, conceptual grouping, and context."
argument-hint: "[uncommitted | commit <hash> | pr <number> | branch <name> | <path>...]"
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
| `<path>...` | If argument matches an existing file or directory, treat as `file <path>`. Multiple paths OK. |

When empty, use AskUserQuestion. Show smart options based on repo state (hide "uncommitted" if clean, etc.).

**Path detection**: If the argument doesn't match any keyword (`uncommitted`, `commit`, `pr`, `branch`, `file`), check if it's a valid file or directory path. If so, tour changes scoped to those paths. For directories, include all changed files under that tree.

When the user picks "commit", show recent commits and ask which. For "PR", ask for the number. For "branch", show branches and ask which.

## Step 2: Gather the diff and context

Use jj commands if VCS is "jj", git commands otherwise.

| Scope | git | jj |
|---|---|---|
| uncommitted | `git diff HEAD` | `jj diff --git` |
| commit | `git show <hash>` | `jj diff --git -r <change-id>` |
| pr | `gh pr diff <n>` + `gh pr view <n>` + `gh pr view <n> --comments` | same |
| branch | `git diff $(git merge-base HEAD <branch>)` | `jj diff --git -r 'latest(trunk())..@'` |
| file / paths | `git diff HEAD -- <path>...` | `jj diff --git <path>...` |

For PR tours, also fetch the PR title/description and reviewer comments for context.

## Step 2.5: Calibrate depth to diff size

Count the number of changed lines (additions + deletions) in the diff.

| Size | Changed lines | Format |
|---|---|---|
| **Small** | < 30 | One short paragraph: what changed and why. No sections, no headers. Done. |
| **Medium** | 30–200 | Overview + reading order + walkthrough (Parts 1–3). Include Part 4 only if something genuinely warrants it. |
| **Large** | > 200 | Full structure (Parts 1–4). |

For small diffs, skip directly to output after writing the paragraph — do not continue to Step 3.

## Step 3: Build the tour

Read source files as needed for context around changes — not just the diff lines, but enough surrounding code to understand the "before" state and how changed pieces connect.

### Part 1: Overview

A 2-4 sentence summary of what this changeset does and why. State the goal, not just the mechanics.

For large diffs, also include a **conceptual map**: which components/subsystems are involved, how they relate, and what the "before" state looked like. This is the mental model the reader needs before diving into details. A short list or a sentence per component is fine — don't over-produce.

### Part 2: Reading order

An ordered list telling the reader exactly where to start and where to go next. Each entry is a `file:line` reference with a one-line note on what they'll find there.

Example:
> 1. **server.rs:45** `handle_request()` — new entry point, start here
> 2. **validation.rs:12** `validate()` — called from handle_request, contains the core logic change
> 3. **types.rs:8** `RequestBody` — new struct both of the above depend on

Group by concept, not by file. If a single concept spans three files, those three entries are adjacent. If one file has two unrelated changes, they appear in different groups.

For medium diffs this can be short (3-5 entries). For large diffs, use labeled groups:

> **Auth flow:**
> 1. ...
> 2. ...
>
> **Database migration:**
> 3. ...

### Part 3: Walkthrough

Organized by concept (matching the reading order groups), not per-file. For each concept:

1. **What changed**: One-line summary.
2. **Why**: How this fits into the overall goal. Skip for trivial changes (imports, formatting).
3. **Key details**: Specific lines worth understanding — new APIs, algorithm choices, data flow changes, subtle behavior. Reference `file:line`.

For simple/medium diffs where concepts and files are 1:1, per-file is fine — don't force artificial grouping.

### Part 4: Decisions and open questions (optional)

Include this section only when there's something genuinely worth calling out. Combine two perspectives:

**Decisions and tradeoffs** visible in the diff:
- Why approach X over alternatives?
- What tradeoffs were made? (performance vs readability, duplication vs abstraction, etc.)
- Implicit assumptions the reader should know about?

**Open questions** the diff leaves unanswered:
- "Is the fallback on line 42 intentional, or a placeholder?"
- "Should this new endpoint have rate limiting?"

Skip the entire section if nothing warrants it. Don't fabricate tradeoffs or invent questions.

## Presentation style

- Conversational but direct — like a colleague walking you through code at your desk.
- Reference specific `file:line` throughout. The reader should be able to follow along in their editor.
- Use code snippets (under 5 lines each) only when they clarify something prose can't.
- Bold key terms and file names for scannability.
- Don't repeat information across sections — each section adds new perspective.
- Scale output to input: a 50-line diff gets a few paragraphs, not a 500-line tour.
