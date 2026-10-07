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

Run `plan-reviewer` with `model_override: "mg:review_thorough"`. Fix findings
by tightening existing text before adding more, and give later rounds only
the plan diff and the earlier findings. At the level's round cap, or when
findings go in circles, ask the operator. A fix that changes a consequential
decision goes back to the operator too.
