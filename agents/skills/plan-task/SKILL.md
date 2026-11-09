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

Plan the smallest implementation that meets the requirements. Guards,
fallbacks, config options, abstractions, validation layers, compatibility
shims, bookkeeping artifacts, and extra tests must earn their complexity:
name the requirement they serve, the concrete risk they address, or the
existing complexity they remove. Cut those without a grounded reason.
Respect real trust boundaries and secret handling; hypothetical misuse
alone does not justify new machinery.

Run `plan-reviewer` with `model_override: "mg:review_thorough"`, and ask it
to flag unnecessary machinery already in the plan, not just missing pieces.
Findings that add scope pass the same test: accept those that close a real
requirements or verification gap, address a concrete risk, or simplify the
implementation; rebut the rest briefly with evidence. Do not add machinery
merely to satisfy a review finding.

Fix accepted findings by tightening existing text before adding more, and
give later rounds only the plan diff, earlier findings, and rebuttals.
At the level's round cap, or when findings go in circles, ask the operator.
A fix that changes a consequential decision goes back to the operator too.
