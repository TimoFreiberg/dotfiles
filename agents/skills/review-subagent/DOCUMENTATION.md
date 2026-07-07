### D — Documentation & Comments

The bar for every judgment here is the **surprise test**: would a competent
engineer who knows this codebase — but does not hold all of it in their head —
be surprised by the fact a comment states? If they would not be surprised, the
comment is noise. Apply this test before flagging anything below.

**Bias conservative.** These findings are consumed by an unsupervised fix loop:
a flagged comment gets edited or deleted with no human triage. A too-verbose
comment surviving one more round is cheap; a useful comment deleted by the fixer
is expensive and easy to miss. So:

- Flag only clear violations. When genuinely ambiguous, stay silent.
- Quote the **specific offending clause**, not the whole comment.
- State what should remain, so the fixer trims surgically instead of deleting
  the comment wholesale.

#### Verbosity smells to flag

- **Implementation-history narration.** Comments describing how the code came
  to be, what it used to do, or the journey to the current form. Allowed ONLY
  when the code would look wrong or surprising without it AND the comment makes
  clear that the surprising-looking code is actually correct. Otherwise flag it.
- **PR-episode narration.** A comment that narrates the *development episode
  that produced this diff*: the bug it fixes and the mechanism of that bug, what
  the old code did before this change, why the author took this approach, what
  the previous test failed to cover. This is distinct from the history bullet
  above and does NOT get its exception — flag it even when it accurately explains
  surprising code, because this backstory belongs in the commit message / PR
  description, not the source. The test: would this sentence read as stale to a
  future engineer who never saw the change land? If it only makes sense as "here
  is what I just did and why," it is PR-episode narration. Flag the narrating
  clauses; leave any terse operational note (e.g. "requires the integration
  fixture"). Example to flag:

  ```
  # Regression test for the ticket: enqueueing a zero-priority job used to crash
  # the worker -- next_ready() returned a null handle and the dispatch loop
  # dereferenced it unconditionally -> segfault. The earlier queue test only
  # survived because every case pushed a high-priority job, so the null path was
  # never hit.
  ```

  The bug mechanism, the "used to crash", and the "earlier test only survived
  because" are all PR-episode narration. What the test asserts *now* is fine to
  keep (compressed if long); the story of the bug and the prior test is not.
- **Internal-API caller coupling.** A comment on an internal function that
  explains how a *specific caller* handles its return value or arguments (e.g.
  "returns -1 on failure, which `open_socket` checks explicitly"). The function's
  own doc should not reach into caller behavior. Flag the caller-describing
  clause. Documenting the function's own contract is fine — but only the
  *surprising* parts of it (see below).
- **Uninteresting edge-case enumeration.** Spelling out non-surprising
  possibilities: "this `Option` may be `None`", "this count can be zero", "this
  int can be negative", "this fd can be -1". These are only worth a comment when
  the edge is genuinely surprising for this function. Flag the routine ones.
- **Restating the type in prose.** `// the user's name (a string)` above
  `name: String`, or `@param count The count`. The signature already carries
  this. Flag the type-echo.
- **Change- or diff-relative comments.** `// now returns a Result instead of
  panicking`, `// changed to use the new API`. "Now" and "changed" are anchored
  to a moment that is meaningless once merged — this belongs in the commit
  message, not the code.
- **Redundant section or banner comments.** `// --- helpers ---`,
  `// constructor`, `// getters and setters`, `// imports` — structural
  narration that adds nothing over the code's visible shape. BUT defer to the
  file-adaptation rule below: some codebases use section banners as a deliberate
  convention, so do not flag them when the file consistently uses them.
- **Narrating obvious control flow.** `// loop over the items` above a `for`,
  `// return early if empty`, `// increment the counter`. Step-by-step
  narration of self-evident code.
- **Attribution or provenance noise.** `// AI-generated`, `// copied from
  StackOverflow`, `// per code review feedback`, `// as suggested by X`. Process
  metadata, not code knowledge.

#### Public vs internal asymmetry

Enumeration that is noise on an internal function is a virtue on a public one.
Calibrate the bar to the API boundary:

- **Obviously public / external API** (exported, in a header, crate-public,
  documented interface): do NOT flag thoroughness. Exhaustive enumeration of
  arguments, return values, and edge cases is appropriate here.
- **Obviously internal API** (private, module-local, not exported): hold the
  surprising-only bar. Flag routine enumeration and caller-coupling.
- **Ambiguous middle:** adapt to the surrounding file. If the file already
  documents every argument exhaustively, follow that example and don't flag. If
  the file has few comments and a diff adds a couple of `pub` methods, a
  succinct comment explaining something non-obvious (without merely restating
  the name) is good — do not flag it. Flag only comments that clearly exceed the
  file's established density.

#### Other documentation findings

- Comments that restate what the code visibly does.
- Comments inaccurate, outdated, or misleading relative to the code.
- Doc-comment claims unsupported by the code — cross-reference every factual
  claim against actual code paths. Read the full source files (not just the
  diff) when verifying doc claims.
- Missing docs where the *why* is non-obvious (and would pass the surprise test).
- TODO/FIXME/HACK: new ones deferring work that should land in this diff, or
  existing ones in touched code referencing resolved issues / deleted code.
