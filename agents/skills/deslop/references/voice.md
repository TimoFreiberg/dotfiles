# Preferred voice

Apply this on top of the deslop rules. Where the two disagree, this file wins.
All examples below are invented.

## Overall

Practical and direct, about the change at hand. Explain the concrete cause and
consequence, not the value of the change. Confidence tracks evidence: use
"should", "might", or "probably" when the outcome isn't verified, and say what
a fix doesn't cover. Contractions, "we", and parentheses are normal. Stop when
the useful information ends; no wrap-up.

## Overrides to deslop

- Passive voice is fine when the affected thing is the subject that matters:
  "The widget is removed when its timer expires."
- A list of three is fine when there are three separate items. Don't build
  triplets for rhythm.
- Parentheses are common and welcome for caveats and qualifiers.
- Length follows the content. A detailed causal chain or a caveat is worth the
  words; a one-line subject with no body is often enough.
- Hedges are fine when they're honest ("I haven't checked whether this helps
  with an empty store"). Never invent certainty, test results, or follow-ups.
- Still no em dashes, and avoid semicolons.

## Commit messages

Subject: imperative verb, specific, usually well under 72 characters, no
trailing period. "Fix expiry after a widget is replaced", not "Enhance widget
lifecycle management".

Body only when the why isn't obvious. A few plain sentences: what went wrong,
why, what the fix does, and any limit. A flat fact can close it ("This saves
one allocation."). No bullet scaffolding for a single change.

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

## Code comments

Explain why: the invariant, the edge case, the surprising choice. Ordinary
inline comments may start lowercase and skip the period; doc comments use
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
