---
name: grill-me
description: "Use when stress-testing a plan or design, or when option exploration will culminate in a high-confidence implementation plan — investigates first and resolves every consequential decision with the user."
---

# Grill Me

Interview the user until the design is understood well enough that implementation cannot silently invent consequential decisions. Investigate before asking, distinguish engineering judgment from code trivia, and keep the user informed without making them micromanage obvious mechanics.

## Decision boundary

A decision is **consequential** when credible alternatives differ materially in architecture, structural complexity, state or invariants, ownership or lifecycle, concurrency, hot-path allocation/copying/locking/I/O, failure behavior, compatibility, security, operability, or future constraints. Diverging from the closest analogous design is consequential unless evidence shows a dominant choice with no meaningful downside.

The user decides consequential tradeoffs. Before asking, gather enough evidence to present the existing pattern, credible options, consequences, and a recommendation. Require an affirmative answer before treating a consequential choice as resolved: general trust in your recommendation, deadline pressure, an opportunity to object, opt-out wording, or silence is not a decision. Do not quietly choose a theoretically cleaner design that adds a pool, cache, queue, store, abstraction, ownership boundary, control path, or lifecycle.

Resolve local code trivia autonomously when one repository-consistent choice has no meaningful competing downside: names, mechanical helper extraction, formatting, and similarly low-impact details. When unsure which side of the boundary a decision falls on, ask.

## Interview

1. **Gather context.** Read the request or plan, then inspect the relevant code, tests, docs, recent history, and authoritative external sources. Answer factual questions from evidence rather than asking the user. Done when you can explain what the work touches, what exists today, and which constraints matter.
2. **Check scope.** If the request contains independent efforts, identify them and agree which one to resolve first. Mark every other effort as excluded, separately deferred with approval, or intentionally included in a sequenced plan; do not silently bundle or drop it.
3. **Find the viable approaches.** Present the credible shapes of the solution, their evidence and tradeoffs, and your recommendation. Do not manufacture alternatives to reach an arbitrary count. Settle the overall approach before resolving branches beneath it.
4. **Map the decision tree.** Cover purpose and success criteria, non-goals, architecture, data and state, interfaces and UX, dependencies, edge cases, and applicable assurance concerns.
5. **Resolve one branch at a time.** Start with the highest-impact unknown. Ask one focused question, or one tightly coupled set that must be answered together. Explain your recommendation and wait for the answer before moving on.
6. **Track a decision ledger.** Keep facts, constraints, local decisions, user decisions, open forks, and explicit deferrals distinct. After each branch, briefly restate the decision and its consequences so the user can correct it.
7. **Push back on ambiguity.** Treat vague answers as unresolved when they would leave execution to choose a consequential tradeoff. Explain the concrete decision being deferred rather than accepting “we'll figure it out.”
8. **Sweep for omissions.** Before closing, check the whole design for contradictions, scope creep, hidden design choices, unnecessary complexity, divergence from analogous code, and unresolved dependencies. Reopen any branch that fails.

## Assurance sweep

Evaluate every domain below. Discuss and record the applicable ones; omit irrelevant boilerplate, explaining only surprising omissions:

- correctness invariants and state transitions;
- concurrency, ownership, lifetime, cancellation, and cleanup;
- performance budgets and hot-path costs;
- partial failure, retries, timeouts, backpressure, overload, and recovery;
- compatibility, migration, rollout, rollback, and mixed-version behavior;
- security boundaries and untrusted input;
- observability, diagnostics, and operator response;
- test levels, fault injection, benchmarks, and test-infrastructure adequacy;
- documentation and ongoing support burden.

## Completion

Resolve every consequential decision or explicitly defer it with the user's approval of the concrete bounds. The agent may propose a bounded deferral, but “leave it TBD,” “figure it out later,” or approval to defer in general does not authorize agent-invented placeholder behavior. Present the proposed bounds and require an affirmative answer before handoff. An explicit deferral records:

- the unresolved decision and why it is deferred;
- the bounded placeholder behavior or work omitted for now;
- what implementation may do and must not decide;
- the accepted consequence or risk and the follow-up trigger.

A deferral may not silently delegate the decision to a later agent. If the later execution environment cannot ask the user, it must be able to complete the approved bounded work without resolving the TBD.

Finish with a compact interview record: objective, scope, evidence, decisions and rationale, invariants, applicable assurance findings, explicit deferrals, and remaining risks. When another workflow invoked this skill, return that record to the caller so it can produce its required artifact. Do not implement the design.
