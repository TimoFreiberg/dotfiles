---
name: plan-task
description: "Use when planning implementation work in plan facet"
---

Run `grill-me` before writing the plan, even when the request sounds
specific. In-scope work that isn't planned needs an operator-approved
deferral with bounds: what execution may do meanwhile and what it must not
decide.

Choose a review level per @skill:review-levels, and open the plan with exactly
"Execute with AT-skill:orchestrator(review level: <level>).", replacing `AT-`
with `@`.

Plan the simplest correct design that serves the task's goals, including the
operator's stated ambition, operational constraints, and reviewability needs.
Carry any stated priorities into the plan so implementers and reviewers
preserve them. Ask when competing priorities would materially change the
approach.

Complexity must earn its place through a requirement, a concrete risk, or a
simplification. Prefer what the codebase and its dependencies already provide.
Respect real trust boundaries and secret handling. Surface safeguards that
materially restrict useful behavior or introduce operational prerequisites in
the plan's summary, with their tradeoffs, before approval. Clarify whether the
tool or its operator is responsible for them.

Distinguish lasting regression coverage from one-off verification that the
change was carried out. Name how each acceptance criterion will be checked.
Commit tests that protect meaningful behavior. Prefer standalone commands or
temporary scripts outside the committed deliverable for change-specific
verification. If temporary tests are added to the repository, identify them in
the plan and remove them after review, then verify the final deliverable with
the retained checks.

Run `plan-reviewer` with `model_override: "mg:review_thorough"`, and ask it
to flag unnecessary machinery already in the plan, not just missing pieces,
while respecting the distinction between lasting regression coverage and
one-off verification.
Findings that add scope pass the same test: accept those that close a real
requirements or verification gap, address a concrete risk, or simplify the
implementation; rebut the rest briefly with evidence. Do not add machinery
merely to satisfy a review finding.

Fix accepted findings by tightening existing text before adding more, and
give later rounds only the plan diff, earlier findings, and rebuttals.
At the level's round cap, or when findings go in circles, ask the operator.
A fix that changes a consequential decision goes back to the operator too.
