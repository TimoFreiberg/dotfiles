---
name: dev-review-loop
description: "Deliberate dev → review → fix loop run in-session: implement directly, spawn /review fresh each round, fix findings or pause for human decisions; 3-round cap."
argument-hint: "[<task description> | file <path>]"
---

# Dev Review Loop

A deliberate dev → review → fix loop on the current task. Once invoked, this
skill drives the session until it ends.

## Core idea

**You are the dev.** Implement the work yourself in this session — don't
spawn a dev subagent. The reviewer runs fresh each round (via `/review`),
which provides the outside-view check on the diff. The diff is the durable
artifact across reviewer invocations; commit at every round transition.
The conversation is not the source of truth.

The loop ends on: review passes, all findings rejected, or the 3-round cap.
It pauses (resumable) on **DECISIONS_NEEDED** — either per-finding
trade-offs or orthogonal design questions raised by the dev. The user
resumes you on response.

## Entry points

The task spec comes from `$ARGUMENTS`: the argument string, or — if it starts
with `file ` — the contents of the named path (read once, treat as the brief).
When bare (no args), summarize the prior in-session discussion in 2-5 sentences
and confirm with the user before starting (skip confirmation only if the
immediately prior message was already a clean task spec; note "treating <prior
message> as the spec"). Fresh session with no prior context: stop and ask.

## Setup

Detect VCS:

- **jj**: `test -d .jj` — use jj commands.
- **git**: otherwise use git commands.

Verify the working copy is clean before recording the base. If it isn't,
decide with the user: commit-as-prelude (so the loop's diff stays scoped to
new work) or fold into round 0 (if the existing edits are part of this task).
When folding, treat the pre-existing edits as part of the round-0 scope and
include them when re-reading the task spec for the self-recheck.

- **jj**: `jj diff --stat` should be empty.
- **git**: `git status --porcelain` should be empty.

Record the **base revision** for cumulative diffs:

- **jj**: `jj log -r @- --no-graph -T change_id` (parent of the current empty working copy).
- **git**: `git rev-parse HEAD`.

Throughout this skill, only commit if there are real changes
(`jj diff --stat` or `git diff --cached --stat` first). No empty commits.

**Round numbering**: round 0 is the initial dev pass. Each subsequent
review + fix pair is round N (N = 1, 2). Round 3 is review-only — see
[Loop cap](#loop-cap). A decisions commit uses the same N as the fix
round whose decisions it applies.

## Round 0: Develop

Build what the task spec asks for, in this session. Use the tools you'd
normally use — read files, edit, run tests. Stay scoped: a bug fix doesn't
need a surrounding refactor.

If you hit a question that needs a human decision before you can proceed,
**stop and report STATUS: DECISIONS_NEEDED** with the question and any
options you've considered. Don't guess. The user resumes you on response;
see [Resumption](#resumption) for what to do then.

## Self-recheck checklist

Run through this **before** committing each round, including Round 0. Items
1-3 gate the commit — fix anything that surfaces. Items 4-6 are evidence:
paste actual output (numbers, exit codes), not adjectives. Diff-pattern
catches (debug prints, stray `.unwrap()`, swallowed errors, etc.) are the
reviewer's job; don't pre-empt them here.

**Did I do what was asked?**

1. Re-read the original task. For each requirement: addressed,
   deferred-and-flagged, or missed?
2. Anything I punted on, hardcoded, or deferred without flagging?
3. Edge cases I noticed but didn't handle?

**Verification evidence** (paste actual output, not adjectives):

4. Test command + result (e.g., `pytest → 34/34 pass`, not "tests pass").
5. Build command + exit code.
6. Linter/typecheck command + warning/error count.

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
the task spec via `--instructions` (free-form reviewer hints):

- **jj**: `Skill(skill: "review", args: "--instructions \"<task spec>\" commit <base_change_id>..@-")`
- **git**: `Skill(skill: "review", args: "--instructions \"<task spec>\" commit <base_sha>..HEAD")`

The `/review` skill returns per-axis verdicts and an overall verdict.

### Overall verdict: correct → loop done

Tell the user the review passed. Summarize total rounds. List any P2/P3
findings. Skip to **Squash on completion** below.

### Overall verdict: needs attention → continue to fix

Pass **all** findings (not just P0/P1) to the fix step.

## Round N: Fix

Triage the findings yourself, in this session. For each finding:

- **FIX** — real issue or easy improvement (style/clarity nit with an
  obvious fix). Apply it now.
- **DISAGREE** — finding is hypothetical, factually wrong, a matter of
  taste, or would require disproportionate rework to be consistent.
  One-line reason.
- **NEEDS_DECISION** — real issue, but the fix involves a trade-off or
  design choice that needs human input. Describe the options briefly.

Apply all FIX changes. Leave NEEDS_DECISION items untouched.

If during triage (or anywhere mid-round) you hit a question of your own —
not tied to a specific finding — that needs a human decision before you
can proceed, **stop and report STATUS: DECISIONS_NEEDED** with the
question and any options you've considered. Don't guess. See
[Resumption](#resumption) for what to do when the user responds.

Then run the **self-recheck checklist** again before committing.

Commit (only if real changes):

- **jj**: `jj commit -m "dev-review-loop round N: fix"`
- **git**: `git add -A && git commit -m "dev-review-loop round N: fix"`

Pick **one** STATUS, in this priority order:

1. **DECISIONS_NEEDED** — any NEEDS_DECISION items exist (even if you also fixed things).
2. **ALL_DISAGREED** — you rejected everything.
3. **FIXES_APPLIED** — you fixed things, disagreed with the rest.

### STATUS: ALL_DISAGREED → loop done

Tell the user all remaining findings were rejected. List the rejections.
Skip to **Squash on completion**.

### STATUS: DECISIONS_NEEDED → pause for user

Report your triage (or the design question) to the user. **Stop and wait for
the user to respond.** Do not spawn another reviewer or continue the loop.
See [Resumption](#resumption) for what to do once they respond.

### STATUS: FIXES_APPLIED → next review round

Continue: gather diff → review.

## Resumption

When the user responds to a DECISIONS_NEEDED pause, what you do next depends
on where you paused:

- **Paused mid-Round-0** (design question raised before the round-0 commit):
  apply the user's answer, keep developing the rest of round 0, run the
  checklist, commit `round 0: dev`, and continue: gather diff → review.
- **Paused mid-triage** (orthogonal question raised during round-N triage,
  before the fix commit): apply the user's answer, finish triaging the
  remaining findings, apply FIX changes, run the checklist, commit
  `round N: fix`, and continue: gather diff → review.
- **Paused mid-fix** (per-finding trade-off after the round-N fix commit):
  apply the user's decisions, run the checklist, commit
  `round N: decisions`, and continue: gather diff → review.

## Loop cap

3 review rounds total. The full shape is `dev → review₁ → fix₁ → review₂
→ fix₂ → review₃`. If review₃ still surfaces findings, **stop and
escalate to the user** — do not apply fixes after the final review. List
outstanding findings (per-axis verdicts, P0/P1 items, anything you'd
otherwise fix) and let the user decide what to do.

## Squash on completion

When the loop ends (review passes, all findings rejected, or cap hit),
**don't squash unprompted**. Surface the round commits and a starter command
**for the user to run** — let them inspect and pick the granularity. They
might want to keep dev, fix, and decisions as separate logical commits.

- **jj**: "`jj log -r <base>+::@-` shows the round commits. To collapse them
  all into the round-0 commit, run
  `jj squash --from '<base>+::@-' --into <base>+ --use-destination-message`.
  See the `jj` skill for variants. **NEVER** run `jj squash` without `-m` or
  `--use-destination-message` — bare squash hangs on the editor."
- **git**: "`git log <base_sha>..HEAD` shows the round commits. Fold them with
  `git reset --soft <base_sha> && git commit` (single commit) or
  `git rebase -i <base_sha>` (keep boundaries)."

## Reporting

After each round, give the user a concise summary — don't dump full reviewer
output, summarize it yourself. The shape:

- **Per-round**: what changed (round 0) or what findings + how you triaged
  (round N) + checklist verification numbers. E.g., "Built X. pytest 34/34
  pass." or "Fixed C1, rejected S1 (naming nit). Tests still 34/34."
- **DECISIONS_NEEDED**: state the question, options considered, that you're
  pausing. E.g., "Hit a design question mid-round: <question>. Options: A, B."
- **Loop end**: which exit (passed / all rejected / cap hit), outstanding
  findings if any, plus the squash command for the user to inspect and run.

## Common mistakes

| Mistake                                  | Fix                                                                       |
|------------------------------------------|---------------------------------------------------------------------------|
| Spawning a dev subagent                  | You are the dev. `/review` is the only subagent.                          |
| Self-recheck items 4-6 as adjectives     | Paste actual output: `pytest 34/34 pass`, not "tests pass".               |
| Forgetting to commit between rounds      | The reviewer reads the diff from the base; uncommitted changes are invisible. |
| Treating NEEDS_DECISION as fix-or-skip   | Real trade-offs need human input. Pause, report, wait for resume.         |
| Squashing the round commits unprompted   | Surface the squash command; let the user pick the granularity.            |
| Guessing past your own mid-dev question  | Stop and report DECISIONS_NEEDED. The user resumes you with the answer.   |
