### S — Style & Design

Decide whether this is well-shaped code for this codebase. Style means placement,
boundaries, API shape, naming, readability and idiomatic implementation—not
formatting preferences. Apply the same standard to production code and tests.

- **Fit the codebase without copying its weaknesses.** Inspect nearby patterns
  before calling something inconsistent. Follow established idioms when they
  help readers; improve mediocre patterns locally when the benefit is concrete.
  Avoid gratuitous divergence, idealized architecture and unrelated cleanup.
- **Put concepts where they belong.** Look for confused ownership, layering,
  misleading interfaces and coupling that makes the change harder to follow or
  use correctly. Propose a concrete better shape, not an abstraction for its own
  sake. Moving complexity elsewhere is not an improvement.
- **Make tests explain behavior.** Check test placement, fixtures, assertions
  and use of existing test conventions. Flag structures that obscure what is
  being tested or couple tests unnecessarily to implementation details. Whether
  the test actually proves the right behavior belongs to Correctness; whether
  its machinery earns its upkeep belongs to Leanness.

For each finding, show the inspected code, the concrete alternative and the
maintenance or comprehension benefit. Existing style is context, not a ceiling;
novelty alone is neither a defect nor a virtue. Preserve behavior and keep the
remedy local.

**Calibration:** Findings feed an automated fix loop. Be conservative about
preferences: clear harmful structure can be high severity; debatable taste is
not a finding. Leave purely unnecessary machinery to Leanness.
