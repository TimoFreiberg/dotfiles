# Preferred voice

Apply this on top of the deslop rules. Where the two disagree, this file wins.
All examples below are invented.

## Overall

Practical and direct, about the change at hand. Explain the concrete cause and
consequence, not the value of the change. Confidence tracks evidence: use
"should", "might", or "probably" when the outcome isn't verified, and say what
a fix doesn't cover. Contractions, "we", and parentheses are normal. Stop when
the useful information ends; no wrap-up.

Cut what the reader doesn't need in order to act: context they already have,
how a result was found, reassurance. Keep conditions and limits. A shorter
sentence that drops an "only when" or an exception is a bug.

Know what the reader can already see. A code comment sits next to the code, a
commit message next to its diff, a review comment next to the author's own
code. Don't restate that. Spend the words on what they can't see from there:
why, the condition that triggers it, the consequence.

## Overrides to deslop

- Passive voice is fine when the affected thing is the subject that matters:
  "The widget is removed when its timer expires."
- Naming the actor doesn't mean inventing one. If no person did it, describe
  the result ("The test fails with an empty store"), and don't claim "I
  tested" for checks you didn't run yourself.
- A list of three is fine when there are three separate items. Don't build
  triplets for rhythm.
- Parentheses are common and welcome for caveats and qualifiers.
- Length follows the content. A detailed causal chain or a caveat is worth the
  words; a one-line subject with no body is fine for trivial changes.
- Hedges are fine when they're honest ("I haven't checked whether this helps
  with an empty store"). Never invent certainty, test results, or follow-ups.
- Still no em dashes, and avoid semicolons.

## Commit messages

Subject: imperative verb, specific, usually well under 72 characters, no
trailing period. "Fix expiry after a widget is replaced", not "Enhance widget
lifecycle management".

For non-trivial changes, add a few plain sentences: a bird's-eye view of what
changed, why (when not obvious), the high-level approach if relevant, and any
limit. A flat fact can close it ("This saves one allocation."). No file lists,
detailed change lists, or bullet scaffolding for a single change.

```
Fix expiry after a widget is replaced

The old timer can still fire after the replacement is stored and remove
the new widget. Check the stored timestamp before deleting. A stale read
is still possible if the timestamp changes during lookup, but that's
much rarer.
```

## PR descriptions

Open on the problem, the change, or a ticket reference. No "## Summary"
heading unless the template demands it. Use "I" for the author's own decisions
and ask reviewers direct questions. Bullets only for genuinely separate changes
or known issues. End with whatever is last and useful: a limitation, a test
result, a question.

> Load the widget index once at startup instead of on every request. This cut
> startup time by about 15% in my test (probably less with a small store).
>
> I left the old cleanup path in place for now. Should we remove it in a
> separate PR?

Reviewers read the description next to the diff. Describe behavior, risk, and
what's blocking the merge, not the code:

- No lists of added functions, types, or files. "Adds FFI accessors for the
  new claims" beats naming all ten. Design reasons (a lifetime invariant, why
  a union) go in code comments, not the PR.
- Put blockers and release holds (dependencies, "don't release beyond canary
  until…") near the top, and state each fact once, not again in a later
  section.
- Delete template sections that don't apply instead of filling them with
  "None, because…".
- Report only testing the reviewer can't see: perf runs, manual checks,
  canaries. CI and the test files already show which tests exist and pass.
- Don't answer checklist items in advance ("Adds no `unwrap` on input
  paths") or tell reviewers where to focus ("X is the main thing to check:").
  State the fact itself.
- Skip reasons the reader can work out. "Depends on #11, which has to merge
  first" needs no "because we pin its head (full SHA)".

## Code comments

Explain why: the invariant, the edge case, the surprising choice. Match the
casing and punctuation of the comments around yours. In new code, ordinary
inline comments may start lowercase and skip the period, and doc comments use
normal sentence case. Use "we" and backticked identifiers. Flag open questions
with `TODO:` rather than glossing over them.

```rust
// we keep the old timestamp so a retry doesn't extend the expiry
// TODO: check whether a cancelled insert can leave this entry behind
```

## Don't

- Promotional or sweeping language ("robust", "comprehensive", "seamless").
- Headings or summaries on small changes.
- Lowercase, humor, or hedging as a tic in every paragraph. They're options.
- British spellings; use US English.
