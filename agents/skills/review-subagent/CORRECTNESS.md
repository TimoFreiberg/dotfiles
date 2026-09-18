### C — Correctness & Intent

Decide whether the change does the right thing in the real system, not merely
whether the diff looks plausible. Review production code and tests together.

- **Follow the behavior across boundaries.** Inspect definitions, callers and
  shared contracts beyond the diff. Find concrete behavioral, security and
  compatibility defects, including incomplete propagation and failures hidden
  by plausible defaults or fallbacks. Check material documentation claims too.
- **Verify the verification.** For changed behavior, identify the test or other
  repository check that would fail if it were wrong or reverted, even when no
  tests changed. For changed tests, check that they exercise production behavior
  and fail for the intended reason. Expected values must come from intended
  behavior, not merely observed output. Resolve code/test disagreements against
  that intent before proposing assertion changes.
- **Read the supplied plan first, when present.** Check every requirement,
  invariant, non-goal, approved decision and bounded deferral for omissions and
  excess. Do not derive requirements from the implementation. Record each item's
  status and evidence in an intent checklist within Coverage. A real mismatch
  blocks conformance regardless of bug severity; ambiguous intent needs the
  owner's clarification, not your chosen interpretation. Give a separate
  conformance verdict: conformant, not conformant, or clarification required.

Surface evidenced defects generously; drop speculative scenarios. Request new
verification only for a demonstrated, consequential gap after inspecting existing
checks. Important rare failures count; coverage volume does not. Report what you
checked and what remains uncertain. Leave code shape to Style and unnecessary
machinery to Leanness.
