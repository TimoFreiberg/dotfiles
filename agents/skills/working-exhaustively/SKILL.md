---
name: working-exhaustively
description: "Use when the user asks to be exhaustive, thorough, comprehensive, or rigorous, wants a finding drilled into or adversarially verified, or when missing something would be costly — a deliberate deep-work mode that trades speed for rigor."
user-invocable: true
---

# Working Exhaustively

Single-pass work optimizes for an answer that looks right; this mode optimizes
for one that *is* right, and spends extra passes to get there.

This costs real time and tokens, so it's a mode you turn on — not a default.

## When to use

- The user signals it: "exhaustive", "thorough", "comprehensive", "rigorous",
  "drill down", "adversarial", "leave no stone unturned".
- The cost of a miss is high: irreversible changes, security, data integrity,
  an audit or review someone will rely on.
- The work is open-ended discovery where you can't see the whole space at once
  (bug hunts, research, "find everything that…").

Skip it when one pass already settles the question, or speed matters more than
completeness.

## The disciplines

Reach for the ones the task needs — not all of them every time.

1. **Decompose into phases.** Understand → design → implement → review. Keep
   them separate; don't let an implementation detail pollute the design pass.
   Finish a phase before starting the next.

2. **Sweep from independent angles.** Search by container, by content, by
   entity, by time — each angle is blind to what the others catch. One search
   pattern finding nothing is not evidence of absence.

3. **Verify adversarially.** Try to *break* each load-bearing claim — don't
   re-read it and nod. Handing it to a *fresh* subagent prompted to refute it is
   ideal; the context that produced a claim rubber-stamps it. When a subagent
   isn't warranted or available, the floor is to falsify it yourself: name the
   input, ordering, or case that would make it wrong. See below.

## Before you finish — every time

These two aren't task-dependent; they're the exit gate.

- **Critique for completeness.** Ask what's missing — an angle not swept, a
  claim unverified, a file unread — and treat the answer as the next round, not
  a footnote. Stop when a completeness pass turns up nothing load-bearing.

- **Declare your caps.** If you bounded coverage — top-N, sampled, skipped a
  path, couldn't see a dependency — say so. Silent truncation reads as "I
  covered everything" when you didn't.

## Adversarial verification, in detail

- **Spawning is ideal; falsification is the floor.** A separate context tests
  what the producing one rubber-stamps — but the discipline is the *attempt to
  break*, not the subagent. When a fresh agent isn't warranted (a snippet you
  can reason about whole) or available, falsify in place: state the case that
  defeats the claim, and keep the claim only if you can't find one.
- **Independence is the whole point.** Give the verifier the bare claim, not
  your reasoning for it — your reasoning leaks the conclusion, and it'll defer
  instead of testing.
- **Frame it to refute, not confirm.** "Find the flaw in X; default to 'flawed'
  if unsure" surfaces more than "is X correct?".
- **Vote when it matters.** For a high-stakes claim, spawn three verifiers and
  keep it only if a majority fail to refute it.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Firing this on a cheap turn | The overhead only pays off when correctness is at stake. |
| Self-verifying by re-reading | Re-reading confirms; try to *break* the claim — spawn an agent or falsify in place. |
| Stopping at the first empty sweep | One dry angle isn't absence; try the others first. |
| Listing options instead of acting | Decompose and *do*; surface the trade-off, don't stall on it. |
