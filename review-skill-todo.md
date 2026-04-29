# Review skill — open questions & deferred trim candidates

Context: Thia proposed trimming `agents/skills/review/SKILL.md` in the
session on 2026-04-29. Ran a `testing-skills-with-subagents` comparison
(n=1 per variant, sonnet reviewer, one synthetic diff with 10 planted
findings). Trimmed version caught 10/11, current caught 11/11.

## Shipped in that session

- Merged "Evidence discipline (load-bearing)" section into the item-5
  bullet list (removes redundancy, one instruction surface for Evidence).
- Compressed "What to flag" from 5 criteria (a-e) to 2 — "meaningfully
  impacts / is actionable / don't demand inconsistent rigor."
- Default model flipped from `opus` to `sonnet` (three occurrences:
  argument-hint subsection, Step 3 header-print description, Step 4
  spawn-reviewer description).

Both content cuts showed zero observed degradation in the n=1 test.

## Not shipped — trim candidates held pending more data

### C-axis enumerations (SKILL.md per-axis guidance, C bullets)

Proposed cut: remove general-knowledge edge-case enumerations from the
C bullets. Specifically:

- Bullet 1: "(nil, empty collections, integer limits, Unicode edges)"
- Bullet 2: "(use-after-free, double-free, uninitialized reads, …
  lifetime issues)" — keep `unsound unsafe`
- Bullet 2: "(overflow/truncation on cast, unchecked arithmetic)" —
  keep the category name, drop the in-parens list
- Bullet 2: "(data races, missing synchronization, lock ordering, TOCTOU)"
  — keep `TOCTOU` as the doctrinal callout, drop the others

Rationale for cut: a capable reviewer knows these edge cases; the
category names already cover them.

Rationale for hold: in the n=1 test, both versions caught the planted
C-axis findings (truncation on cast, unsound unsafe, log-and-continue)
equally. But the test didn't stress-test what happens when the reviewer
has to reach for less-canonical edge cases (Unicode-boundary bugs, TOCTOU
in uncommon shapes, etc.). One clean single-run pass is weak evidence
that the cut is safe across diff distributions.

**Follow-up:** re-test with a diff that actively features Unicode-
boundary logic OR TOCTOU OR lifetime-driven UAF — see whether the
trimmed C-axis still catches it. If yes with 3+ diffs, ship the trim.

### S-axis line-level readability (SKILL.md per-axis guidance, S last bullet)

Proposed cut: remove "nested ternaries, long chains, dense
comprehensions" from the line-level readability bullet. Keep
"functions doing too many things" and "AI-generated verbosity where
idiomatic code would be shorter."

Rationale for cut: known patterns; "AI-generated verbosity" is the
doctrinal callout worth keeping.

Rationale for hold: in the n=1 test, the planted diff had a nested
if-else chain in `priority()` that neither version flagged. So the
experiment didn't actually test whether dropping the nested-ternary
guidance matters — both versions missed it with the guidance intact.
That's a null result about the guidance's effectiveness, not evidence
that dropping it is safe.

**Follow-up:** build a diff where nested-ternary / long-chain
readability is the most egregious issue AND not-dominant over other
findings. Compare catch rate. If the guidance doesn't help in the
current version, keep the cut on the table as "dead weight."

### Open perf-finding regression observed in n=1

The trimmed version missed `median_size` being O(n log n) in a hot
`priority()` call path. Current version caught it as S1 [P1]. The
finding doesn't map to any specific bullet I cut — suggests a "broad
thoroughness" effect from longer per-axis guidance that can't be
predicted from which specific bullets remain.

**Follow-up:** run 3-5 more trials on varied diffs before committing to
any per-axis trims. If perf findings keep dropping in the trimmed
version, that's a signal that the shorter prompt costs reviewer depth
in ways not localized to the cut bullets.

### Sonnet-vs-opus delta at production tier

All testing done on sonnet (per `testing-skills-with-subagents` guidance
to test one tier below production). Default is now sonnet in the skill,
so this is moot for current production — but worth revisiting if the
default ever flips back to opus: opus may catch everything in both
versions and make the 11/11 vs 10/11 delta disappear, which would make
all the held cuts safe to ship.

## Sonnet-vs-opus spot checks

Goal: periodically sanity-check that sonnet isn't missing important
findings opus would catch. On a real review from the workflow:

1. Note the sonnet reviewer's findings.
2. Re-run `/review --model opus <same scope>`.
3. Compare: does opus find anything sonnet missed? Is the severity
   calibration materially different?

Worth doing once every few weeks, or on a review that feels "too clean"
relative to the diff's complexity.

## Meta-shape worth naming

`testing-skills-with-subagents` is expensive to run at statistical-
confidence scale (each variant needs an agent call, varied diffs cost
real time to hand-craft). But a single-run directional test can split a
proposal into "observed-safe cleanups" and "unproven cuts" — ship the
safe ones, keep the unproven ones deferrable. This file records the
unproven ones with enough context to re-test cheaply when opportunity
arises (e.g. when writing a real diff that happens to match the
missing-test-case shape).
