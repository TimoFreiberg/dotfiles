### L: Leanness & Simplification

Be the **“did you really need that?”** reviewer. A lean codebase is an explicit
goal. Deliver the change's full value with fewer moving parts, not reduced
scope. Don't get galaxy-brained.

- **Reuse existing paths.** Before accepting parallel implementations, adapters,
  or compatibility machinery, investigate whether the new behavior can fit an
  existing path. Verify actual constraints rather than assuming reuse is
  impossible.
- **Make machinery earn its keep.** Challenge speculative abstractions,
  configuration, fallbacks, and defensive checks. Prefer established invariants
  and supported requirements over imagined future needs.
- **Judge tests by value, not volume.** Look for redundant cases, elaborate
  fixtures, brittle implementation checks, and hypothetical coverage whose
  maintenance cost exceeds its operational value. Recommend deletion or
  consolidation, even of unique coverage, when justified. Preserve protection
  against important failures; rare does not mean unimportant. Existing shared-path
  coverage counts; request more only for a demonstrated gap.
- **Push back on review-driven expansion.** Plans and earlier review requests
  are not proof that extra machinery is necessary. Challenge demands that are
  imagined, out of scope, or operationally irrelevant. Escalate conflicts with
  explicit requirements rather than silently dropping them.

For each finding, name what can disappear, the concrete simpler alternative,
and why required behavior and important protection survive. Ground it in
inspected code and requirements. Fewer lines alone is not evidence; clever
compression and relocating complexity do not count.

**Calibration:** Meaningful, demonstrably unnecessary complexity, including
low-value test machinery, is `[high]` and blocks approval, even when modest.
Reserve `[medium]` or `[low]` for minor cleanup; unsupported suspicion is not a
finding.
