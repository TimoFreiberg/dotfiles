---
name: orchestrator
description: "Use when executing a multi-step plan and each implementation step should be delegated to subagents and independently reviewed."
---

# Orchestrator

Coordinate implementation of a plan one open task at a time. Use
`review-subagent` for code quality and `plan-conformance-review` for intent:
delegate implementation, run focused reviews, require the implementer to
address findings, and approve each task before moving on.

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
   not its default cumulative scope. Separately invoke `plan-conformance-review`
   against the same scope with a task-scoped intent contract containing the
   current task plus every applicable global invariant, non-goal, decision, and
   deferral copied faithfully from the approved plan. Do not include later-task
   requirements or reinterpret the plan; uncertain applicability goes to the
   intent owner. The first review checks code quality; the second checks intent.
6. **Resolve findings through the implementer.** Give the complete reports to
   the same implementer. It must fix every determinate finding or rebut it with
   evidence. Route `indeterminate` items and a `clarification required` verdict
   to the intent owner; do not let implementation choose their meaning.
7. **Freeze and repeat the review gate.** After each correction round, verify and
   commit the corrections, record the immutable commit ID, then rerun both skills
   against the updated definite task scope with fresh reviewers. Continue until
   conformance passes and no non-rebutted critical or high code-review finding
   remains. Medium and low findings may remain only when addressed or explicitly
   rebutted; surface accepted risk.
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
   correctness-only reviewer over that final documentation diff. Use the
   `## Reviewer prompt` template from `review-subagent`, but supply only
   `CONTRACT.md` and `CORRECTNESS.md` and instruct it to limit coverage to changed
   factual documentation claims and dangerous omissions. Do not include
   `DESIGN.md` or `TESTS.md`. Fix semantic findings and repeat this narrow check.
10. **Update planning state.** Once approved, mark the task complete, update the
    plan and temporary workspace documents, then continue with a fresh
    implementer for the next task.
11. **Run final whole-plan conformance.** After all tasks pass, commit the final
    state and run `plan-conformance-review` over the cumulative implementation
    scope with the complete approved plan artifact. Resolve mismatches before
    declaring the plan complete; this catches omissions and cross-task drift that
    task-scoped contracts cannot see.

## Orchestrator-specific review gate

Treat the `review-subagent` and `plan-conformance-review` reports as the
authoritative review output; do not rewrite, merge, or silently discard their
findings. A round passes only when all four reports are valid and every finding
is fixed or explicitly rebutted with evidence. The task passes only when the
conformance verdict is `conformant`, no non-rebutted critical or high code-review
finding remains, and every medium or low finding is fixed or explicitly
rebutted.

## Common mistakes

- Implementing several tasks before reviewing any of them. Keep the loop scoped
  to one task.
- Reviewing the cumulative default scope instead of the current task change.
  Pass the same explicit task-scoped revision or range to both review skills.
- Treating a reviewer’s silence or malformed report as approval. Follow both
  review skills' validation rules and rerun or replace failed reviewers.
- Letting the implementer dismiss findings without evidence. Require a fix or
  specific rebuttal for determinate findings; send ambiguity to the intent owner.
- Rerunning against the old commit while corrections remain uncommitted. Freeze
  every correction round and review its updated immutable scope.
- Checking an early task against the complete multi-task plan. Use the faithful
  task-scoped contract, then run whole-plan conformance after all tasks.
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
