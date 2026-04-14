---
name: dev-review-loop
description: "Orchestrate a dev→review→fix loop using subagents. Iterates until review passes or findings are rejected."
---

# Dev Review Loop

You act as the **orchestrator**: you spawn subagents, gather diffs, parse
results, and report to the user. You never write or review code yourself.

## Agent lifecycle

- **Dev agent** — spawned once, continued via SendMessage for gap-fixes and
  review-fixes.
- **Review agents** — fresh each round.
- **Gap-check agents** — fresh each round.

## Overview

1. **Dev subagent** — builds the requested feature
2. **Commit + diff** — you commit changes and gather the diff
3. **Gap check** — dev agent self-check + fresh gap-check subagent
4. **Review** — via `/review` skill
5. **Fix round** — resume the dev subagent to triage and fix findings
6. **Gap check**
7. Repeat 4–6 until review passes or all findings are rejected (max 5 review rounds)

## Setup

Detect VCS:

- **jj**: `test -d .jj` — use jj commands
- **git**: otherwise use git commands

Record the **base revision** for cumulative diffs:

- **jj**: `jj log -r @- --no-graph -T change_id` (parent of the current empty working copy)
- **git**: `git rev-parse HEAD`

**Committing:** throughout this skill, only commit if there are actual changes.
Check first (`jj diff --stat` or `git diff --cached --stat`).

## Round 0: Development

Spawn the dev subagent. **Save its agent ID** — you will resume it via
SendMessage for all subsequent fix rounds.

    Agent(
      subagent_type: "general-purpose",
      description: "Dev: <short summary>",
      prompt: "<task>\n{user's task}\n</task>\n\nBuild this. When done, summarize what you built and list key files."
    )

After it returns, **commit and report**:

1. Commit:
   - **jj**: `jj commit -m "dev-review-loop round 0: dev"`
   - **git**: `git add -A && git commit -m "dev-review-loop round 0: dev"`
2. Report to the user: what was built, key files (2-3 lines).

## Gather the cumulative diff

Always diff from the base revision to the latest commit:

- **jj**: `jj diff --git --from <base_change_id> --to @-`
- **git**: `git diff <base_sha>..HEAD`

If the diff is empty, stop — nothing to review.

## Gap Check

### Step 1: Ask the dev agent

    SendMessage(
      to: <dev agent ID>,
      message: """
        Step back and self-review against the original task:

        <task>
        {user's original task}
        </task>

        What did you skip, punt on, hardcode, or feel uncertain about?
        Any requirements you deliberately deferred or edge cases you noticed but didn't handle?

        Be honest — this is for catching gaps before review, not for judgment.

        Output:
        - SELF_GAPS: numbered list of gaps/concerns, or "none"
      """
    )

### Step 2: Spawn a fresh gap-check subagent

Launch in a **single message** alongside step 1 so both run concurrently.

    Agent(
      subagent_type: "general-purpose",
      description: "Gap check: round N",
      prompt: """
        <task>
        {user's original task}
        </task>

        <diff>
        {cumulative diff}
        </diff>

        You are a gap checker. Review the diff against the original task.
        Read source files for context as needed.

        Look for:
        - Requirements from the task that aren't addressed in the diff
        - Edge cases or error paths that were overlooked
        - Inconsistencies between what was built and what was asked for
        - Obvious correctness issues

        Do NOT flag style, naming, or structure — that's the code reviewer's job.

        Output:
        - GAPS: numbered list of gaps found, or "none"
        - VERDICT: CLEAN if no gaps, GAPS_FOUND if there are gaps
      """
    )

### Step 3: Merge and act

Combine gaps from both sources, deduplicating. If no gaps from either →
continue to review (or done, if this was a post-fix gap check).

If there are gaps, send the merged list to the dev agent:

    SendMessage(
      to: <dev agent ID>,
      message: """
        Gap check found these issues:

        <self-reported>
        {dev agent's SELF_GAPS}
        </self-reported>

        <external>
        {gap-checker's GAPS}
        </external>

        Address each gap. Summarize what you changed.
      """
    )

After it returns, commit:

- **jj**: `jj commit -m "dev-review-loop round N: gap fixes"`
- **git**: `git add -A && git commit -m "dev-review-loop round N: gap fixes"`

Report briefly to the user, then continue (do NOT re-run the gap check — move on).

## Round N: Review

Invoke the `/review` skill with the cumulative revision range:

- **jj**: `Skill(skill: "review", args: "commit <base_change_id>::@-")`
  where `<base_change_id>` is the change ID recorded in Setup.
  (If `/review` doesn't understand the range syntax, fall back to passing the
  cumulative diff as custom instructions.)
- **git**: `Skill(skill: "review", args: "commit <base_sha>..HEAD")`

The `/review` skill will report per-axis verdicts and an overall verdict.

### Overall verdict: correct → loop done

Tell the user the review passed. Summarize total rounds.
If there are P2/P3 findings, list them.

### Overall verdict: needs attention → continue to fix

Pass **all** findings (not just P0/P1) to the fix step.

## Round N: Fix

Resume the **same dev subagent** via SendMessage.

    SendMessage(
      to: <dev agent ID>,
      message: """
        Code review findings to address:

        <findings>
        {review output}
        </findings>

        For each finding (by number), categorize it as one of:

        - **FIX** — real issue, the fix is obvious. Fix it now.
        - **DISAGREE** — nitpick, hypothetical, or factually wrong. Explain why in one line.
        - **NEEDS_DECISION** — real issue, but the fix involves a trade-off or design
          choice that needs human input. Describe the options briefly.

        Apply all FIX changes. Leave NEEDS_DECISION items untouched.

        Output:
        - FIXED: finding numbers, what you fixed and how
        - DISAGREED: finding numbers, one-line reasons
        - NEEDS_DECISION: finding numbers, each with a brief description of the options
        - STATUS: pick the first that applies:
          1. DECISIONS_NEEDED — if any NEEDS_DECISION items exist (even if you also fixed things)
          2. ALL_DISAGREED — if you rejected everything
          3. FIXES_APPLIED — if you fixed things and disagreed with the rest
      """
    )

After it returns, **commit**:

- **jj**: `jj commit -m "dev-review-loop round N: fix"`
- **git**: `git add -A && git commit -m "dev-review-loop round N: fix"`

### STATUS: ALL_DISAGREED → loop done

Tell the user all remaining findings were rejected. List the rejections.

### STATUS: DECISIONS_NEEDED → pause for user

Report the dev agent's triage to the user (fixed, rejected, needs input).
**Stop and wait for the user to respond.**

When the user responds with their decisions, send those to the dev subagent:

    SendMessage(
      to: <dev agent ID>,
      message: "User decisions on review findings:\n\n{user's response}\n\nApply these decisions. Summarize what you changed."
    )

After it returns, commit and continue: gather diff → gap check → review.

### STATUS: FIXES_APPLIED → gap check, then next review round

Report what was fixed and what was rejected, then continue.

## Reporting

After every subagent, give the user a concise summary:

- **Round 0 Dev**: "Built X. Key files: ..."
- **Gap check**: "Clean (both lenses)." or "Found N gaps (2 self-reported, 1 external): G1 ..., G2 .... Sending to dev agent."
- **Round N Review**: "Needs attention — 2 findings: C1 [P0] buffer overflow in parse.c:87, S1 [P2] ..."
- **Round N Fix**: "Fixed C1 (buffer overflow). Rejected S1 (naming nit). **S2 needs your input**: option A does X, option B does Y."
- **Done**: "Passed review in round N" / "All findings rejected in round N". If P2/P3 findings: "Passed with 2 non-blocking findings: D1 [P2] ..., T1 [P3] ..."

Do NOT dump full subagent output. Summarize it yourself.

## Max rounds

5 review rounds. If exceeded, tell the user the loop didn't converge and summarize
outstanding findings.
