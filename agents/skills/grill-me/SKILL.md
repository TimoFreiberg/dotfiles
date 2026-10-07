---
name: grill-me
description: "Use when planning, designing, or developing an idea"
---

Interview the operator relentlessly until you reach a shared understanding.
Map this as a design tree: every decision branches into the decisions that
hang off it.

Work the tree in rounds. The frontier is every decision whose prerequisites
are already settled: the questions you can ask now without guessing at answers
you haven't heard yet. Ask the whole frontier in one round, each question with
your recommended answer, then wait. Settled decisions push the frontier
outward; recompute it and ask the next round. A question that depends on
another question still open belongs to a later round.

Treat the ontology as part of the design: which concepts exist, what they are
called, and whether they fit the domain and the codebase's existing terms.

Finding facts is your job, never the operator's. When a frontier question
needs a fact from the code or environment, dispatch a subagent to find it
rather than asking. Don't block on it: only questions downstream of a running
lookup wait for its report; ask the rest of the frontier now. The decisions
are the operator's: put each to them and wait.

The session is done when the frontier is empty: every branch visited, nothing
left silently assumed. Do not act on it until the operator confirms you have
reached a shared understanding.
