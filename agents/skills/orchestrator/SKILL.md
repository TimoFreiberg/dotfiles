---
name: orchestrator
description: "Use when executing an approved implementation plan: delegate implementation to subagents, run review, test-coverage, and completeness gates with bounded repair rounds, and report every unresolved finding for a follow-up session."
---

# Orchestrator

You coordinate; you do not write production code, tests, or documentation
yourself. Delegate implementation, run the gates, route findings to repairers,
and end with a report a follow-up session can act on without this transcript.

## Inputs

Read the approved plan once and extract:

- **Review level** from the plan's opening "Execute with …" line, falling back
  to its Review Strategy.
  If neither records one, choose one with the rubric in `review-subagent`
  before starting and state the choice and reason in your first message.
- **Round cap:** `routine` ⇒ 2 review rounds; `thorough` and `critical` ⇒ 4.
- Acceptance criteria, invariants, non-goals, approved deferrals, and the
  step-to-test mapping.
- The plan path, for `--plan` on every review.

Record the base commit ID (not the jj change ID) before any implementation.

## Todos

Keep the todo list high level: implementation (one item per phase), gates,
repair rounds, report. Subagents keep their own step-level todos; do not copy
them into yours.

## 1. Implement

One fresh `general-purpose` implementer receives the whole plan by default.

Split into **sequential phases** only when the plan is long enough that one
implementer would plausibly exhaust its context, or the plan itself defines
phases. Each phase gets a fresh implementer, the full plan, the phase's steps,
and the previous phases' reports. Run the build and relevant tests after each
phase before starting the next. Never run implementers concurrently.

Every implementer prompt contains the full plan path, its assigned steps, the
acceptance criteria it owns, the requirement to write the tests the plan maps
to those criteria (loading `writing-tests`), and this return contract:

```
status: complete | blocked
changed_files: [paths]
tests: [test file::name → AC ids it covers]
commands: [command → pass/fail]
skipped: [check → reason]        # a skipped check is not a pass
assumptions: [...]
side_observations: [out-of-scope issues noticed, with file:line]
blockers: [...]
```

Implementers commit their own work at a verified state. They do not expand
scope silently; anything ambiguous goes in `assumptions` or `blockers`.

A `blocked` status that needs an operator decision ends the run: skip to the
report.

## 2. Round 1: parallel gates

When implementation is committed, record the commit ID as the review baseline
and dispatch in parallel, all against that same frozen commit:

- **Review:** `review-subagent --difficulty <level> --plan <plan> commit
  <base>..<baseline>`. This includes plan conformance for the whole change.
- **Coverage check:** one fresh `general-purpose` subagent that reads
  `COVERAGE.md` in this skill's directory and follows it. Give it the plan
  path, the diff artifact from `scope.py`, and the implementers' `tests` and
  `commands` fields.
- **Documentation edit:** `editing-documentation commit <base>..<baseline>`.
  It writes to the working copy; reviewers read the frozen diff, so this is
  safe.

Wait for all three. Commit the documentation edits.

## 3. Findings ledger

Keep one ledger for the run, written to a temporary file so it can be passed
to later rounds. Each entry:

```
id: <reviewer id, e.g. R1-C2, COV-3, CPL-1>
source: review | coverage | completeness
severity: critical | high | medium | low
location: file:line
summary: <one line>
disposition: open | fixed | rebutted | fixed-by-doc-edit | unresolved
note: <fix commit, rebuttal evidence, or why unresolved>
```

Blocking means `critical` or `high`, a `not conformant` plan-conformance item,
or a coverage `not covered` verdict. Medium and low findings are fixed or
rebutted in the same repair pass and never open another round by themselves.

Before repair, mark prose findings that the documentation edit already
resolved as `fixed-by-doc-edit`. A `clarification required` conformance item
goes straight to `unresolved`: implementation must not choose its meaning.

## 4. Repair

Dispatch one repair implementer with the plan, the ledger's open code and test
findings, and the same return contract. It must fix each finding or rebut it
with evidence; rebuttals are recorded, not argued further unless a reviewer
brings new evidence.

Remaining prose findings go to the documentation editor instead (resume the
round-1 editor with `resume_from`), running concurrently with the repair
implementer. Tell both not to commit; commit their combined result yourself
once both finish.

## 5. Verification rounds

After each repair commit, run `review-subagent` again with the same level and
plan, the repair delta as scope (`commit <previous-commit>..<repair-commit>`),
and `--prior-findings <ledger>`. Reviewers in these rounds verify fixes and
examine the repair's blast radius; they do not rescan unchanged code.

- A rebuttal-only round (no code changed) needs no re-review.
- Re-run the coverage check only if it had findings or the repair changed
  tests, and only on the repair delta.
- Stop repairing when the latest round has no open blocking finding.

**Round cap.** Round 1 plus verification rounds count against the cap. When
the cap is reached with blocking findings open, do not start another round:
mark them `unresolved` with the reason `round cap` and continue to the
completeness check. Never downgrade a finding's severity to make a round pass.

**Non-convergence.** If a finding reverses an earlier accepted fix, the same
material is re-litigated without new evidence, or new blocking findings keep
appearing on unchanged code, stop early and treat the remaining findings as
unresolved with the reason `non-convergence`.

## 6. Completeness check

Once, after the review loop ends (clean or capped), dispatch one fresh
`general-purpose` subagent that reads `COMPLETENESS.md` in this skill's
directory. Give it the plan path, the cumulative diff (`commit
<base>..<final>`), and the ledger. Prefer a model different from the first
candidate of the review group when one is available.

If it rejects, run one repair and re-check the repair delta once. Findings
still open after that are `unresolved`. Do not re-run the review panel for a
completeness repair; the next session or the operator's review covers it.

## 7. Report

Final message, in this order:

1. **Outcome:** one line — complete, complete with unresolved findings, or
   blocked.
2. **What changed:** short summary, the base and final commit IDs, and the
   commits in between.
3. **Test inventory:** every new or changed test by name, grouped by
   acceptance criterion. If any criterion has no test, say so explicitly;
   that criterion is an unresolved finding.
4. **How to verify:** concrete commands and observable behavior.
5. **Rebuttals:** each rebutted finding with its one-line evidence, so the
   operator can overrule one.
6. **Unresolved findings**, as a self-contained block the operator can paste
   into a fresh session:

   ```
   ## Unresolved findings
   Plan: <absolute path>
   Change: <final commit ID> (base <base commit ID>)
   Review level: <level>

   ### <id> [<severity>] <file:line> — <summary>
   Why unresolved: round cap | non-convergence | needs operator decision | blocked
   What to do: <the reviewer's recommendation, concrete>
   Evidence: <quoted code or reviewer text>
   ```

7. **Side observations:** out-of-scope issues from implementers and reviewers,
   with `file:line`, unrated.

Omit empty sections.

## Common mistakes

- Writing code yourself instead of dispatching an implementer.
- Running the documentation edit before review instead of beside it.
- Starting a verification round without `--prior-findings`, which turns it
  into a fresh full review and restarts the nitpick cycle.
- Treating a malformed or failed reviewer report as a pass. An incomplete
  batch is a failed round; fix the operational cause and rerun it (this does
  not count against the cap).
- Letting a clean later round erase an earlier unresolved finding.
- Reusing an implementer across phases; each phase starts fresh.
