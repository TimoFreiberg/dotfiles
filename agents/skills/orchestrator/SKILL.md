---
name: orchestrator
description: "Use when executing a multi-step plan and each implementation step should be delegated to subagents and independently reviewed."
---

# Orchestrator

Coordinate implementation of a plan one open task at a time. Delegate the actual
implementation, obtain independent reviews, require the implementer to address
the findings, and continue until the task is approved before moving on.

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
3. **Review independently.** When the implementer finishes, send independent
   reviewer subagents to evaluate the resulting change. Run the reviewers in
   parallel when possible. Use the configured reviewer subagents and models;
   do not force a model override unless the operator explicitly requests one.
   Ask every reviewer to classify findings as **critical**, **high**, **medium**,
   or **low**, and to support findings with concrete file and line references.
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

## Review report contract

Each reviewer should return four clearly labeled sections, in this order:

- `## Critical`
- `## High`
- `## Medium`
- `## Low`

An empty section is valid and should say `None`. Each finding should include:

- severity and a concise title;
- the relevant `file:line` and a short quoted excerpt;
- why it matters;
- a concrete fix or verification request.

A reviewer error, empty report, or report that does not follow this contract is a
failed review. Treat it as a reason to rerun or replace that reviewer, not as
approval.

## Common mistakes

- Implementing several tasks before reviewing any of them. Keep the loop scoped
  to one task.
- Treating a reviewer’s silence as approval. Require the report contract and
  either prompt the reviewer subagent again (or, if it's a oneshot, run another
  subagent).
- Letting the implementer dismiss findings without evidence. Require a fix or
  a specific rebuttal for every finding.
- Stopping after one review round when a critical or high finding remains.
- Forgetting to update the task list, plan, or temporary plan references after
  approval.
- Reusing an implementer for a later task. Use a fresh implementer for each
  task so earlier assumptions do not silently carry over.
