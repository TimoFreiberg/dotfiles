---
name: writing-tests
description: "Use when implementing behavior, adding regression tests, or strengthening a test suite — targets subtle correctness bugs with discriminating examples and generated tests."
---

# Writing Tests

- Before implementing, identify areas likely to have subtle bugs; for each,
  state likely mistakes and plausible alternative interpretations, then choose
  a check whose results differ. Prefer asymmetric inputs and examples below,
  at, and above boundaries.
- After implementing, for high-risk or uncertain behavior, ask a subagent to
  independently choose cases and derive expected results. Give it high-level
  context, the contract, and relevant specifications—not production code, your
  detailed reasoning, or existing tests and answers. Have it work from that
  brief, then compare its results with the implementation.
- When feasible, use property-based testing or fuzzing with semantic assertions,
  not just no-panic/no-crash checks. Prefer an established framework such as
  proptest or Hypothesis for generation, shrinking, and replay; exhaust tiny
  input spaces.
- Steer generation toward interesting states and paths using structured inputs
  and operation sequences. Check that generated cases reach those states rather
  than mostly hitting the same error path.
- Verify that tests reject the plausible mistakes, not merely pass the current
  implementation. Round-trips can hide matching bugs; use independent expected
  results too. Run the tests and retain minimized failures as regressions.
