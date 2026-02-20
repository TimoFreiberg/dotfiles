---
name: dev-review-loop
description: "Orchestrates a dev→review→fix loop using Claude Code subagents. Spawns a dev agent to build something, then iterates code review and fixes until the code passes or findings are rejected. Use when asked to run a review loop, multi-agent development, or iterative code improvement."
---

# Dev Review Loop

Orchestrate a development → review → fix cycle using Task subagents. You act as the
**orchestrator**: you spawn subagents, gather diffs, parse results, and report to the user.
You never write or review code yourself.

## Overview

1. **Dev subagent** — builds the requested feature
2. **Commit + diff** — you commit changes and gather the diff
3. **Review subagent** — diff-scoped code review
4. **Fix subagent** — addresses reasonable findings
5. Repeat 2–4 until review passes or all findings are rejected (max 5 review rounds)

## Setup

Detect VCS:

- **jj**: `test -d .jj` — use jj commands
- **git**: otherwise use git commands

## Round 0: Development

Spawn a dev subagent:

    Task(
      subagent_type: "general-purpose",
      description: "Dev: <short summary>",
      prompt: "<task>\n{user's task}\n</task>\n\nBuild this. When done, summarize what you built and list key files."
    )

After it returns, **commit and report**:

1. Commit:
   - **jj**: `jj commit -m "dev-review-loop round 0: dev"`
   - **git**: `git add -A && git commit -m "dev-review-loop round 0: dev"`
2. Report to the user: what was built, key files (2-3 lines).

## Round N: Gather the diff

Get the diff from the most recent commit:

- **jj**: `jj diff --git -r @-`
- **git**: `git diff HEAD~1`

If the diff is empty, stop — nothing to review.

## Round N: Review

### Load review guidelines

Check if `REVIEW_GUIDELINES.md` exists in the project root. If it does, use its contents.
Otherwise, read `~/.claude/skills/review/SKILL.md` and extract everything under
**"Step 4: Review guidelines"** (the "What to flag", "Review priorities", and "Findings
format" sections).

### Spawn review subagent

    Task(
      subagent_type: "general-purpose",
      description: "Review: round N",
      prompt: """
        <review-guidelines>
        {guidelines}
        </review-guidelines>

        <diff>
        {diff}
        </diff>

        Review the diff following the guidelines. Read source files for context as needed,
        but only flag issues in code that appears in the diff.

        End with:
        - VERDICT: PASS — if no P0 or P1 findings
        - VERDICT: FAIL — if there are P0 or P1 findings

        List all findings regardless of verdict.
      """
    )

Report to the user: verdict + finding count by severity.

### VERDICT: PASS → loop done

Tell the user the review passed. Summarize total rounds.

### VERDICT: FAIL → continue to fix

## Round N: Fix

    Task(
      subagent_type: "general-purpose",
      description: "Fix: round N",
      prompt: """
        Code review findings to address:

        <findings>
        {review output}
        </findings>

        For each finding, decide: REASONABLE (real bug/risk) or FRIVOLOUS (nitpick,
        hypothetical, or factually wrong). Fix reasonable ones. Ignore frivolous ones.

        Output:
        - ADDRESSED: what you fixed and how
        - REJECTED: frivolous findings with one-line reasons
        - STATUS: ALL_FRIVOLOUS if you rejected everything, FIXES_APPLIED if you fixed any
      """
    )

After it returns, **commit and report**:

1. Commit:
   - **jj**: `jj commit -m "dev-review-loop round N: fix"`
   - **git**: `git add -A && git commit -m "dev-review-loop round N: fix"`
2. Report to the user: what was fixed, what was rejected.

### STATUS: ALL_FRIVOLOUS → loop done

Tell the user all remaining findings were rejected.

### STATUS: FIXES_APPLIED → back to diff gathering

## Reporting

After every subagent, give the user a concise summary:

- **Round 0 Dev**: "Built X. Key files: ..."
- **Round N Review**: "FAIL — 2 findings: 1 P0 (buffer overflow in parse.c:87), 1 P2 (...)"
- **Round N Fix**: "Fixed 1 (buffer overflow). Rejected 1 as frivolous (naming)."
- **Done**: "Passed review in round N" / "All findings rejected in round N"

Do NOT dump full subagent output. Summarize it yourself.

## Max rounds

5 review rounds. If exceeded, tell the user the loop didn't converge and summarize
outstanding findings.
