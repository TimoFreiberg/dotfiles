---
name: debug
description: "Use when a test failure, regression, exception, hang, wrong result, or unexpected behavior needs diagnosis — gathers evidence, traces the relevant path, and verifies the cause before recommending a fix."
argument-hint: "<description of the bug or unexpected behavior>"
---

# Debug

Diagnose an observed failure before changing code. A diagnosis is a causal
claim backed by a reproducible observation and evidence that distinguishes it
from plausible alternatives.

## When to use

Use for bugs, regressions, failing tests, exceptions, hangs, and incorrect
results. Do not use it for an implementation request without an observed
failure.

## Core idea

Start from what happened, not what seems likely. Trace only the paths that
could explain that observation, then test the prediction of the leading
hypothesis. A plausible reading of the code is not a verified diagnosis.

## Workflow

1. **Establish the observation.** Record the entry point, expected result,
   actual result, and relevant environment or input. Run the focused failing
   test or reproduction when it is cheap and safe; capture the error, stack,
   logs, and request or trace IDs. If it cannot be reproduced, say which
   observation is the evidence and what is missing.

   Inspect available tests, logs, call sites, and recent changes before asking
   a question. Ask one targeted question only when a material fact cannot be
   derived safely.

2. **Trace the relevant path.** Start at the observed divergence (for example,
   the failure site or incorrect output) and follow data and control flow to
   the nearest point that can explain it. Read the code at each hop; expand to
   another branch only when evidence makes it plausible.

   Check relevant guards and early returns, error propagation, timeouts,
   retries, shared state, and boundary mappings. Stop at a framework or
   library boundary unless the stack, configuration, or evidence points
   inside it. Delegate only independent branches when doing so is available
   and worth the coordination cost.

3. **State falsifiable hypotheses.** For each live explanation, record the
   suspected cause, the evidence supporting it, and a prediction that would
   distinguish it from the alternatives. Keep uncertainty explicit; do not
   turn an untested guess into a diagnosis.

4. **Verify the cause.** Use the least invasive check that tests the leading
   prediction: a focused test, reproduction, log or trace correlation, or
   safe instrumentation. Confirm the predicted behavior and rule out the
   plausible alternatives. If verification is unavailable, report a
   *most-likely cause*, the gap, and the next check rather than claiming a
   root cause.

5. **Report the diagnosis and next action.** Separate facts from inference:
   - Observation and scope
   - Relevant traced path, with file:line references
   - Verified cause, or confidence and remaining uncertainty
   - Evidence and the verification performed
   - The narrowest fix that addresses the cause, its scope boundary, and how
     to prove it works

   Mention an alternative only when it has a material trade-off. Do not
   implement a fix unless the user asks; this skill's deliverable is a
   diagnosis and an evidence-backed recommendation.

## Common mistakes

- **Treating the stack location as the cause.** Trace the invalid value or
  state to where it first diverges from the expected path.
- **Reading the whole codebase first.** Establish the observed failure, then
  widen the trace only as evidence requires.
- **Blaming a recent change by proximity.** Use the diff to form a hypothesis
  and verify its prediction.
- **Changing production behavior to test a theory.** Prefer a focused,
  reversible check; state the risk if no safe verification exists.
