---
name: orchestrator
description: "Use when executing a multi-step plan and each implementation step should be delegated to subagents and independently reviewed."
---

# Orchestrator

Coordinate implementation of a plan one open task at a time. Use the
`review-subagent` skill as the review engine: delegate implementation, run a
focused review, require the implementer to address the findings, and continue
until the task is approved before moving on.

## When to use

Load this skill when a plan has multiple open tasks and you want a disciplined
implement–review–fix loop rather than implementing the whole plan in one pass.

Do not use it for a one-line change, a plan with no open tasks, or a review that
has no implementer or task list to coordinate.

## Procedure

For each open task or plan step, in order:

1. **Choose the next task.** Read the plan and task list. Select the next open
   task or step; do not start later tasks early.
2. **Delegate implementation.** Send a fresh implementer subagent a focused
   prompt containing the task, acceptance criteria, repository context, and
   expected verification. The implementer owns the code change.
3. **Edit documentation.** Invoke `editing-documentation` against the task scope.
   Preserve the initial diff artifact for the final pass. The dedicated subagent
   directly deletes or rewrites changed prose before code review. Require a
   successful result, including an explicit no-op when no edit is warranted.
4. **Verify and freeze the baseline.** Run relevant checks, then commit the
   implementation and initial documentation edit. Record the immutable commit
   ID, not the jj change ID: later squashes can move a change ID to new content.
5. **Run task-scoped review.** Invoke `review-subagent` against the task change,
   not its default cumulative scope. Pass the task acceptance criteria as
   `--description`. Let that skill own scope gathering, reviewer selection,
   report format, and validation.
6. **Resolve findings through the implementer.** Give the complete reports to
   the same implementer. It must fix every finding or rebut it with evidence.
7. **Repeat the review gate.** Review each correction with fresh reviewers until
   no non-rebutted critical or high finding remains. Medium and low findings may
   remain only when addressed or explicitly rebutted; surface accepted risk.
8. **Edit review-loop documentation.** After the review gate passes, commit the
   final fixes and record that commit ID. Invoke
   `editing-documentation since <baseline-commit-id> <final-commit-id>`, passing
   both the new interdiff artifact and the preserved initial implementation diff.
   In jj this uses `jj interdiff` between the two frozen patches; in git it uses
   `git diff <baseline>..<final>`. Never target jj's empty post-commit `@`.
   An empty scope means review fixes introduced no prose to edit and is a
   successful short circuit.
9. **Verify final semantics.** Run relevant tests and documentation checks. If
   the final editor changed factual documentation or comments, run a fresh
   correctness-only reviewer over that final documentation diff. Invoke the
   Group 1 reviewer prompt from `review-subagent`, but supply only `CONTRACT.md`
   and `CORRECTNESS.md` and instruct it to limit coverage to changed factual
   documentation claims and dangerous omissions. Do not include `DESIGN.md` or
   `TESTS.md`. Fix semantic findings and repeat this narrow check.
10. **Update planning state.** Once approved, mark the task complete, update the
    plan and temporary workspace documents, then continue with a fresh
    implementer for the next task.

## Orchestrator-specific review gate

Treat the `review-subagent` reports as the authoritative review output; do not
rewrite, merge, or silently discard their findings. A review round passes only
when both axis-group reports are valid according to that skill and every finding
is either fixed or explicitly rebutted with evidence. The task passes only
when no non-rebutted critical or high finding remains and all medium or low
findings have been fixed or explicitly rebutted.

## Common mistakes

- Implementing several tasks before reviewing any of them. Keep the loop scoped
  to one task.
- Reviewing the cumulative default scope instead of the current task change.
  Always pass an explicit task-scoped revision or range to `review-subagent`.
- Treating a reviewer’s silence or malformed report as approval. Follow
  `review-subagent`’s report-validation rules and rerun or replace failed
  reviewers.
- Letting the implementer dismiss findings without evidence. Require a fix or
  a specific rebuttal for every finding.
- Stopping after one review round when a critical or high finding remains.
- Recording a jj change ID as the documentation baseline. Record the commit ID;
  the fix loop may rewrite or squash the change.
- Skipping the final documentation pass because the initial pass was clean.
- Running the full review suite after final documentation editing instead of the
  narrow semantic check, which can reopen the prose feedback loop.
- Forgetting to update the task list, plan, or temporary plan references after
  approval.
- Reusing an implementer for a later task. Use a fresh implementer for each
  task so earlier assumptions do not silently carry over.
