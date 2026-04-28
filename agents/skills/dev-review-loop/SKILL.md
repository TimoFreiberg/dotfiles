---
name: dev-review-loop
description: "Deliberate dev → review → fix loop run in-session: implement directly, spawn /review fresh each round, fix findings or pause for human decisions; 3-round cap."
argument-hint: "[<task description> | file <path>]"
---

# Dev Review Loop

A deliberate dev → review → fix loop on the current task. Once invoked, this
skill drives the session until it ends.

**You are the dev.** Implement the work yourself — don't spawn a dev subagent.
`/review` is the only subagent, fresh each round. Commit between rounds: the
cumulative diff is what each reviewer sees, and committed rounds keep subsequent
reviews fast and let the reviewer check out context at a definite state.

The loop ends on: review passes, all findings rejected, or the 3-round cap.
It **pauses (resumable)** on DECISIONS_NEEDED — either per-finding trade-offs
or orthogonal design questions. Stop, report, wait for the user.

## Task spec

From `$ARGUMENTS`: the argument string, or — if it starts with `file ` —
the contents of the named path. Bare invocation: summarize prior in-session
discussion in 2-5 sentences and confirm, unless the immediately prior message
was already a clean spec (say "treating <prior> as the spec"). Fresh session
with no prior context: stop and ask.

## Setup

Detect VCS: `test -d .jj` → jj, otherwise git. Verify working copy is clean
(`jj diff --stat` / `git status --porcelain` empty). If not, decide with the
user: commit-as-prelude, or fold pre-existing edits into round 0 (re-read the
task spec against the combined scope for the self-recheck).

Record the **base revision** for cumulative diffs:
- jj: `jj log -r @- --no-graph -T change_id`
- git: `git rev-parse HEAD`

Only commit when there are real changes (`jj diff --stat` / `git diff --cached --stat`
non-empty). No empty commits anywhere in the loop.

## Round 0: develop

Build what the task asks for. Stay scoped — a bug fix doesn't need a refactor.
If you hit a question needing human input before you can proceed, stop and
report **STATUS: DECISIONS_NEEDED**. Don't guess.

## Self-recheck (before every commit, including round 0)

Items 1-3 gate the commit. Items 4-6 need actual output, not adjectives —
diff-pattern catches (debug prints, stray `.unwrap()`, swallowed errors) are
the reviewer's job, don't pre-empt.

1. Re-read the task. Each requirement: addressed, deferred-and-flagged, or missed?
2. Anything punted, hardcoded, or deferred without flagging?
3. Edge cases I noticed but didn't handle?
4. Test command + result (e.g. `pytest → 34/34 pass`).
5. Build command + exit code.
6. Linter/typecheck command + warning/error count.

Then commit: `jj commit -m "dev-review-loop round N: <dev|fix|decisions>"`
(git: `git add -A && git commit -m ...`). Report 2-4 lines to the user.

## Round N: review

Cumulative diff from the base:
- jj: `Skill(skill: "review", args: "--instructions \"<task spec>\" commit <base>..@-")`
- git: `Skill(skill: "review", args: "--instructions \"<task spec>\" commit <base>..HEAD")`

If the diff is empty, stop — nothing to review.

**Review passes** → loop done. Skip to completion.
**Needs attention** → all findings (not just P0/P1) go to fix.

## Round N: fix

Triage each finding: **FIX** (apply now), **DISAGREE** (one-line reason), or
**NEEDS_DECISION** (trade-off needs human input — describe options). Apply
all FIX changes. If an orthogonal question comes up mid-triage, stop with
DECISIONS_NEEDED. Run self-recheck, commit (if real changes).

Exit status, priority order:
1. **DECISIONS_NEEDED** — any NEEDS_DECISION exists → pause, report triage, wait.
2. **ALL_DISAGREED** — everything rejected → loop done, skip to completion.
3. **FIXES_APPLIED** → next review round.

## Resumption

When the user answers a DECISIONS_NEEDED pause, apply the answer, finish any
unfinished triage/development from the paused round, run the checklist, commit
with the appropriate round-N tag (`dev`, `fix`, or `decisions` for per-finding
trade-offs resolved after the round-N fix commit), and continue: diff → review.

## Loop cap

3 review rounds: `dev → review₁ → fix₁ → review₂ → fix₂ → review₃`. If
review₃ surfaces findings, **stop and escalate** — do not fix after the
final review. List outstanding findings, let the user decide.

## Completion

Don't squash unprompted. Surface the round commits and a starter command
for the user to inspect and run:
- jj: `jj log -r <base>+::@-`; collapse with
  `jj squash --from '<base>+::@-' --into <base>+ --use-destination-message`.
  **Never** bare `jj squash` — hangs on the editor.
- git: `git log <base>..HEAD`; fold with `git reset --soft <base> && git commit`
  or `git rebase -i <base>` to keep boundaries.
</content>
