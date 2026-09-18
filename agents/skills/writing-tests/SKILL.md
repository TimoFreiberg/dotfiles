---
name: writing-tests
description: "Use when implementing testable behavior, writing or reviewing tests"
---

# Writing Tests

We don't write tests that pass, we write tests that hunt.

- A test exists to catch a specific bug. Before writing one, name the bug it
  would catch; "it restates what the code does" and "a typo on this line" are
  not bugs. No answer means no test.
- Before implementing, identify areas likely to have subtle bugs; for each,
  state likely mistakes and plausible alternative interpretations, then choose
  a check whose results differ. Prefer asymmetric inputs and examples below,
  at, and above boundaries.
- Test the contract, not the trace. Assert on what a caller can observe and
  relies on. Internal call sequences, private fields, log output, and exact
  error strings belong to the implementation unless they *are* the contract.
- A test that must be updated whenever the implementation changes but the
  contract doesn't is a change detector: maintenance cost, no signal. Rewrite it
  against the contract or delete it.
- Mock assertions that only confirm the mock received the arguments you just
  passed it verify your wiring, not the system. Same for snapshots too large for
  a human to review — a tripwire nobody reads.
- Prefer few tests that fail for distinct reasons over many that fail together.
  Coverage percentage is not the target.
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
- Break the implementation on purpose and confirm the test fails; a test that
  survives a deliberate bug never had teeth. Round-trips can hide matching bugs;
  use independent expected results too. Run the tests and retain minimized
  failures as regressions.
