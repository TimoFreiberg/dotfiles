---
name: plan-task
description: "Use when planning implementation work in plan facet"
---

# Plan Task

Produce a reviewed handoff plan. This skill adds to the plan facet's own
instructions.

## 1. Interview

Invoke `grill-me` before writing the plan and follow it to completion, even
when the request sounds specific. The operator decides every consequential
tradeoff. Silence, an agent-authored `TBD`, general permission to defer, or
"decide during implementation" is not a decision.

Execute cannot ask questions, so every approved deferral records its bounded
placeholder behavior, what execution may and must not decide, the accepted
risk, the follow-up trigger, and the operator's approval.

## 2. Choose the review level

Classify implementation review as `routine` or `thorough` with the rubric in
`orchestrator` ("Review levels": risk, not size). Record `critical`
only when the operator explicitly asked for it. The
level sets the round cap for plan review here and for implementation review
in `orchestrator`: 2 for `routine`, 4 otherwise. Do not inflate it for
caution.

## 3. Write the plan

The plan opens with one line:
"Execute with @skill:orchestrator(review level: <level>)."
Replace `<level>` with the review level, otherwise keep this verbatim to keep
the skill reference intact.

Follow the facet's plan specification, and carry the `grill-me` record into
the plan: non-goals, each consequential decision with its rationale and
whether the operator made it, and approved deferrals with their bounds. When
the plan is long, mark phase boundaries; `orchestrator` gives each phase a
fresh implementer.

For each area the plan modifies, say whether to replace or patch it. Replace
when most of it would change, when its structure is wrong for the
requirement, or when the change adds branches to already-complex code.

**Specification band.** Include enough to verify the work and nothing that
only narrates how to build it. Required: observable done-when criteria with
concrete literals, settled interfaces at every boundary, migration strategy
for touched persisted or wire formats, test intent per criterion, touch
points. Not required: internal algorithm choices any conforming
implementation could make, or code-granularity steps.

**Cold start.** A fresh implementer must be able to execute without this
conversation: concrete paths, commands, and names; no references to chat
history or unstated context.

**No escape hatches.** Do not write `optional`, `if time permits`, `best
effort`, `stub for now`, `leave a TODO`, or "if X is hard, do Y instead" for
in-scope work. Write "if X is hard, research and solve X." Out-of-scope work
belongs under non-goals; in-scope work that must wait needs an approved
deferral.

## 4. Review loop

Run the `plan-reviewer` subagent with `model_override: "mg:review_thorough"`,
and include these filing rules in its prompt:

- "Insufficient detail" must name the verification it blocks. "Excess detail"
  must name the constraint it gets wrong or the implementer freedom it removes
  without contract value.
- Borderline severity is medium, not high. Rate impact if unfixed, not effort.

**Findings ledger.** Assign each finding an id (`P1-3`: round 1, finding 3)
and record its disposition: `fixed`, `rebutted` (with evidence), or `open`.

**Dispositions: tighten, don't expand.** Fix a finding by tightening or
clarifying existing text first; add steps, sections, or criteria only when
that cannot resolve it. Every addition is new surface for the next round.
Fix or rebut medium and low findings in the same pass; they never trigger
another round.

**Rounds 2+ verify.** Give the reviewer the ledger and the plan diff since the
last round. It confirms each fix, checks the edited text for regressions, and
does not re-open rebutted findings without new evidence or rescan unchanged
sections. A new critical or high finding on unchanged text must explain why
earlier rounds missed it.

**Stop conditions:**

- Done when the latest round has no open critical or high finding.
- **Round cap** reached with critical or high findings open: stop and ask the
  operator with the outstanding findings and your proposed dispositions.
- **Oscillation:** a finding that reverses an earlier accepted fix, or the
  same material re-litigated without new evidence: stop and ask the operator.

Never downgrade a finding to end the loop.

**Test infrastructure gaps.** If a behavior cannot be adequately tested
because the harness or tooling is missing: when building it is local,
repository-consistent mechanics, add it to the plan with its own acceptance
criteria. When it is a consequential expansion, ask the operator through
`grill-me`: build it now, reduce scope to what is testable, or split it off.
Proceeding without it is an explicit deferral that forbids claiming coverage
for the affected criteria.

## 5. Re-grill on consequential edits

Clerical and reviewer-requested clarifications need no new interview. An edit
that changes scope, architecture, state, lifecycle, concurrency, failure
semantics, compatibility, security, or another consequential choice goes back
through `grill-me` for an operator decision, then back through review.

## 6. Handoff

Call `handoff_plan` once the loop has ended cleanly or the operator has
decided on what remains. Auto-handoff never supplies approval for
consequential choices, deferrals, or test gaps.
