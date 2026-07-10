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
   prompt containing the task, relevant acceptance criteria, repository context,
   and the expected verification. The implementer owns the code change and
   should report what it changed and what it tested.
3. **Run a task-scoped review.** Invoke the `review-subagent` procedure against
   the resulting task change, not its default cumulative scope. Pass the task’s
   acceptance criteria as `--description`. Let that skill own scope gathering,
   reviewer selection, prompts, report format, and report validation; run its
   independent reviewers in parallel as specified there.
4. **Resolve findings through the implementer.** Give the complete reviewer
   reports to the same implementer subagent. It must fix every finding or
   explicitly rebut it with evidence and explain why no change is warranted.
5. **Repeat the gate.** If any critical or high finding remains non-rebutted,
   have the implementer make another correction, then run a fresh independent
   review. Repeat until no reviewer has a non-rebutted critical or high finding.
   Medium and low findings may remain only when the implementer has addressed
   or explicitly rebutted each one; surface any accepted residual risk.
6. **Verify approval.** Run the task’s relevant tests or checks after the final
   fixes. Do not mark the task approved based only on reviewer output.
7. **Update planning state.** Once approved, mark the task complete in the task
   list, update the plan document, and update any temporary workspace documents
   that reference the plan.
8. **Continue.** Start the next open task with a fresh implementer subagent.

## Orchestrator-specific review gate

Treat the `review-subagent` reports as the authoritative review output; do not
rewrite, merge, or silently discard their findings. A review round passes only
when both reviewer reports are valid according to that skill and every finding
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
- Forgetting to update the task list, plan, or temporary plan references after
  approval.
- Reusing an implementer for a later task. Use a fresh implementer for each
  task so earlier assumptions do not silently carry over.
