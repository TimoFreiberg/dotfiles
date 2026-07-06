### T — Test Correctness

Review only test code that was added or modified. If the diff contains no test
code, mark the Test Correctness coverage line accordingly and emit no
T-prefixed findings.

**Guard against masking bugs.** The fix loop is unsupervised, and the dangerous
failure mode here is the *opposite* of the documentation and design axes: rather
than deleting good things, a fixer will happily rewrite a test to pass against
broken code — changing an assertion to match a buggy output and making a real
bug look fixed. So:

- When a test and the code it exercises disagree, do NOT assume the test is the
  wrong side. State which side you believe is authoritative and why.
- Frame such findings as "verify against intended behavior", not "change the
  expected value". Never phrase a finding in a way that invites blindly
  rewriting an assertion just to make it pass.
- If you cannot tell which side is right, say so and flag it for human
  attention rather than implying the test should change.

A specific masking tell: an expected value **captured from the code's actual
output** rather than derived from the requirement. Such a test asserts "the code
does what it does" and cannot catch a bug. When you suspect this, say the
expected value should be derived from intended behavior, not copied from output.

**The revert experiment.** For each meaningfully changed line of production
code, mentally revert it and ask: which test goes red? If the answer is "none,"
that is a finding — name the line and the missing coverage. This is the sharpest
check for "tests with no failing case" and for change that ships untested.

#### Primary smell — over-mocking

The test smell most worth catching. Flag when a test asserts that a **mock was
called** (or configures elaborate mock behavior) instead of asserting the real
output or observable behavior of the code under test. Such a test passes as long
as the wiring is unchanged and tells you nothing about correctness. Prefer a
test that exercises real behavior; flag mocks that stand in for the very logic
being tested.

#### Core correctness smells

- **Tautological assertions.** Passing regardless of the code under test.
- **Wrong expected values.** But apply the masking guard above before concluding
  the *test* is wrong.
- **Passes for the wrong reason.** Testing an error path that never triggers, a
  condition that is always true, an assertion that never actually runs.
- **Not exercising production code.** Helpers or fixtures that reimplement the
  logic under test, so the test only checks its own reimplementation.
- **Wrong test layer.** Heavy mocking that only tests implementation details
  when an integration test would cover the same behavior without brittleness.
- **Flaky patterns.** Time-dependent, order-dependent on unordered data, missing
  cleanup.

#### Secondary smells

Worth catching but subtler and seen less often:

- **Snapshot / golden tests blindly regenerated.** A fixer updates the snapshot
  to match new output without anyone checking the output is correct — a special
  case of the masking guard.
- **Tests with no failing case.** Asserting something trivially true, or missing
  the negative / error assertion entirely.
- **Coverage-theater.** Calling a function and asserting only that it "does not
  throw", with no real check on the result.
