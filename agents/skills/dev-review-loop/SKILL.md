---
name: dev-review-loop
description: "Use when the user wants a dev → review → fix loop on the current task — runs the work in this session and uses /review as the only subagent. Iterates until review passes, all findings rejected, or 3 review rounds elapse."
argument-hint: "[<task description> | file <path>]"
---

# Dev Review Loop

**You are the dev.** Implement the work yourself, in this session. Don't spawn a
dev subagent. The only subagent is the reviewer (via `/review`), which runs
fresh each round.

This skill takes over the rest of the session's context budget. The user opts
in by invoking it; once invoked, the session is given over to the loop. The
loop ends on review-passes, all-findings-rejected, the 3-round cap, or a
pause-for-user.

The diff is the durable artifact across reviewer invocations, so commit at
every round transition. The conversation is not the source of truth.

## Entry points

Pick one based on `$ARGUMENTS`:

| Invocation                          | Task spec is...                                                |
|-------------------------------------|----------------------------------------------------------------|
| `/dev-review-loop "<text>"`         | The argument string itself.                                    |
| `/dev-review-loop file <path>`      | The contents of `<path>` (read it once, treat as the brief).   |
| `/dev-review-loop` (bare, no args)  | The recent in-session discussion (summarize it as a task spec). |

For bare mode: write a 2-5 sentence summary of the task as you understand it
from the prior turns. Confirm it with the user before starting work, **unless
the immediately prior message was already a clean task spec** — in that case
proceed and note "treating <prior message> as the spec."

## Setup

Detect VCS:

- **jj**: `test -d .jj` — use jj commands.
- **git**: otherwise use git commands.

Record the **base revision** for cumulative diffs:

- **jj**: `jj log -r @- --no-graph -T change_id` (parent of the current empty working copy).
- **git**: `git rev-parse HEAD`.

Throughout this skill, only commit if there are real changes
(`jj diff --stat` or `git diff --cached --stat` first). No empty commits.

## Round 0: Develop

Build what the task spec asks for, in this session. Use the tools you'd
normally use — read files, edit, run tests. Stay scoped: a bug fix doesn't
need a surrounding refactor.

If you hit a question that needs a human decision before you can proceed,
**stop and report STATUS: DESIGN_QUESTION** with the question and any
options you've considered. Don't guess. The user resumes you on response.

## Self-recheck checklist

Run through this **before** committing each round, including Round 0. This
is a gate, not a suggestion — if any of items 1-3 surface a real issue, fix
it before continuing to the review round. Items 4-6 want concrete output,
not adjectives — gather the numbers if you don't already have them.

**Did I do what was asked?**

1. Re-read the original task. For each requirement: addressed,
   deferred-and-flagged, or missed?
2. Anything I punted on, hardcoded, or deferred without flagging?
3. Edge cases I noticed but didn't handle?

**Verification evidence** (paste actual output, not adjectives):

4. Test command + result (e.g., `pytest → 34/34 pass`, not "tests pass").
5. Build command + exit code.
6. Linter/typecheck command + warning/error count.

**Cheap pattern catches in the diff:**

7. Debug code: `console.log`, `dbg!`, `println!`, `print(`, `pp`.
8. Commented-out blocks I forgot to remove.
9. New TODO/FIXME I added (existing ones are fine).
10. `.unwrap()` / `.expect()` on fallible ops outside tests.
11. `any` / `unknown` without justification comment (in TS).

**Failure-philosophy check:**

12. Any try/catch swallowing errors silently? Any backwards-compat hacks
    left in? Any "this should never happen" without a loud failure?

## Commit (after Round 0 dev)

Only after the checklist is clean:

- **jj**: `jj commit -m "dev-review-loop round 0: dev"`
- **git**: `git add -A && git commit -m "dev-review-loop round 0: dev"`

Report briefly to the user: what was built, key files, checklist verification
numbers (2-4 lines).

## Gather the cumulative diff

Always diff from the base revision to the latest commit:

- **jj**: `jj diff --git --from <base_change_id> --to @-`
- **git**: `git diff <base_sha>..HEAD`

If the diff is empty, stop — nothing to review.

## Round N: Review

Invoke `/review` as a fresh subagent each round. Pass the cumulative range and
the task spec.

Prefer `--description` if `/review` accepts it (it carries the task spec into
the reviewer's plan-alignment check). If not, fall back to `--instructions`,
which the current `/review` accepts as free-form hints.

- **jj**: `Skill(skill: "review", args: "commit <base_change_id>::@- --description \"<task spec>\"")`
- **git**: `Skill(skill: "review", args: "commit <base_sha>..HEAD --description \"<task spec>\"")`

If `/review` errors on `--description`, retry with `--instructions "<task spec>"`.

The `/review` skill returns per-axis verdicts and an overall verdict.

### Overall verdict: correct → loop done

Tell the user the review passed. Summarize total rounds. List any P2/P3
findings. Skip to **Squash on completion** below.

### Overall verdict: needs attention → continue to fix

Pass **all** findings (not just P0/P1) to the fix step.

## Round N: Fix

Triage the findings yourself, in this session. For each finding:

- **FIX** — real issue, fix is obvious. Apply it now.
- **DISAGREE** — nitpick, hypothetical, or factually wrong. One-line reason.
- **NEEDS_DECISION** — real issue, but the fix involves a trade-off or design
  choice that needs human input. Describe the options briefly.

Apply all FIX changes. Leave NEEDS_DECISION items untouched.

If during triage (or anywhere mid-round) you hit a question of your own —
not tied to a specific finding — that needs a human decision before you
can proceed, **stop and report STATUS: DESIGN_QUESTION** with the question
and any options you've considered. Don't guess.

Then run the **self-recheck checklist** again before committing.

Commit (only if real changes):

- **jj**: `jj commit -m "dev-review-loop round N: fix"`
- **git**: `git add -A && git commit -m "dev-review-loop round N: fix"`

Pick **one** STATUS, in this priority order:

1. **DESIGN_QUESTION** — you raised a design question and stopped (handled
   above; this status fires at the moment you stop, not after triage).
2. **DECISIONS_NEEDED** — any NEEDS_DECISION items exist (even if you also fixed things).
3. **ALL_DISAGREED** — you rejected everything.
4. **FIXES_APPLIED** — you fixed things, disagreed with the rest.

### STATUS: ALL_DISAGREED → loop done

Tell the user all remaining findings were rejected. List the rejections.
Skip to **Squash on completion**.

### STATUS: DECISIONS_NEEDED or DESIGN_QUESTION → pause for user

Report your triage to the user (fixed, rejected, needs input). **Stop and
wait for the user to respond.** Do not spawn another reviewer or continue
the loop.

When the user responds, apply their decisions, run the checklist, commit
(`... round N: decisions`), and continue: gather diff → review.

### STATUS: FIXES_APPLIED → next review round

Continue: gather diff → review.

## Loop cap

3 review rounds. If round 3 still has findings, tell the user the loop
didn't converge and summarize outstanding findings. Don't keep trying.

## Squash on completion

When the loop ends (review passes, all findings rejected, or cap hit),
**don't squash unprompted**. Surface the round commits and a starter command;
let the user inspect and pick the granularity. They might want to keep dev,
fix, and decisions as separate logical commits.

- **jj**: "`jj log -r <base>::@-` shows the round commits. Fold them with
  `jj squash` (interactively, or e.g. `jj squash --from "<base>+::@-" --into <base>+`
  to collapse all into the round-0 commit). See the `jj` skill for details."
- **git**: "`git log <base_sha>..HEAD` shows the round commits. Fold them with
  `git reset --soft <base_sha> && git commit` (single commit) or
  `git rebase -i <base_sha>` (keep boundaries)."

## Reporting

After each round, give the user a concise summary — don't dump full reviewer
output, summarize it yourself.

- **Round 0 dev**: "Built X. Key files: ... Checklist: pytest 34/34 pass, build exit 0, ruff 0 warnings."
- **Round N review**: "Needs attention — 2 findings: C1 [P0] buffer overflow in parse.c:87, S1 [P2] ..."
- **Round N fix**: "Fixed C1. Rejected S1 (naming nit). **S2 needs your input**: option A does X, option B does Y."
- **DESIGN_QUESTION**: "Hit a design question mid-round: <question>. Options: A, B. Pausing."
- **Done (passed)**: "Passed review in round N. Squash command: <…>"
- **Done (all rejected)**: "All findings rejected in round N. Squash command: <…>"
- **Cap hit**: "Hit 3-round cap with outstanding findings: F1 ..., F2 .... Squash command: <…>"
