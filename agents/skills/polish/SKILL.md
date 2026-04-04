---
name: polish
description: Analyze a codebase for improvements across multiple dimensions — test coverage gaps, documentation quality, performance, API ergonomics, correctness. Use when the user wants to find what's missing or could be better in their project.
argument-hint: "[dimension ...] (e.g. tests, docs, perf, api, correctness — or empty for all)"
disable-model-invocation: true
allowed-tools:
  - Bash(cargo test *)
  - Bash(cargo check *)
  - Bash(cargo clippy *)
  - Agent
  - Read
  - Glob
  - Grep
---

## Repo state

- VCS: !`test -d .jj && echo "jj" || echo "git"`
- Language: !`test -f Cargo.toml && echo "rust" || (test -f package.json && echo "node" || (test -f go.mod && echo "go" || echo "unknown"))`

## Step 1: Determine scope

Available dimensions:

| Dimension | What it covers |
|---|---|
| `tests` | Coverage gaps, untested public API, missing edge cases, flaky patterns |
| `docs` | Crate/module docs, doc comments on public items, README, examples |
| `perf` | Unnecessary allocations, hot-path inefficiency, lock contention, algorithmic issues |
| `api` | Ergonomics, misuse resistance, consistency, naming, type-level invariants |
| `correctness` | Error handling, safety invariants, panic/crash paths, resource leaks, thread safety |

If `$ARGUMENTS` is empty, run **all five** dimensions.

If `$ARGUMENTS` names specific dimensions (e.g. `/polish tests docs`), run only those. Accept common aliases: `test`→`tests`, `doc`/`documentation`→`docs`, `performance`→`perf`, `ergonomics`→`api`, `sound`/`soundness`/`safety`/`unsafe`→`correctness`.

If `$ARGUMENTS` contains something else, treat it as custom focus instructions and pass it verbatim (delimited by triple backticks) to all agents.

## Step 2: Launch parallel analysis agents

Launch one Agent subagent per selected dimension, all in a single message. Each agent receives the shared analysis guidelines (below) followed by its dimension-specific guidelines.

Each agent should use Read, Glob, and Grep extensively to examine the full codebase — this is not diff-scoped.

### Shared analysis guidelines

Include the following in every subagent prompt.

Analyze the **entire codebase**, not just recent changes. Read every source file relevant to your dimension. The goal is to find what's missing, incomplete, or improvable — not to review a specific change.

**What to flag** — gaps or issues that: (a) would meaningfully improve the project if addressed; (b) are specific and actionable; (c) aren't nit-picks or style preferences; (d) the author would likely agree with.

**Don't flag** — things that are fine as-is for the project's current scope, speculative future needs, or patterns that are idiomatic even if imperfect.

**Priorities** — tag each finding: [P0] blocking issue, must fix; [P1] high-value, should do; [P2] worth doing; [P3] nice-to-have.

**Format** — number findings with the dimension prefix (T1, D1, F1, A1, C1, …). For each: priority tag, file path with line number where relevant, one-paragraph explanation. Be specific — "add tests for X" not "improve test coverage." Report in under 500 words.

### Agent: Tests (prefix: T)

Identify gaps in test coverage and test quality.

- List every public function/method/type. For each, note whether it has direct test coverage.
- Flag untested public API surface — these are the highest priority.
- Flag untested error paths and edge cases.
- Check for missing integration tests of key workflows (especially any documented in specs/README).
- Flag flaky test patterns: time-dependent, order-dependent, non-deterministic.
- Note if property-based/fuzz testing would add value for any component.
- Check that tests actually assert meaningful properties (not just "doesn't panic").

Don't suggest tests for trivial getters/setters or boilerplate impls. Focus on behavioral gaps.

### Agent: Documentation (prefix: D)

Evaluate documentation completeness and quality.

- Check for crate/module/package-level docs (the overview a new user sees first).
- List every public item without a doc comment.
- Check README: does it exist? Does it have a usage example? Is it accurate?
- Check for runnable examples (doctests, examples/ directory).
- Evaluate existing doc comments: do they explain *why*, not just *what*? Are they accurate?
- Check for stale/misleading comments that contradict the code.
- Note if a CHANGELOG exists (relevant if the project is published).

Don't flag missing docs on items where the name and type signature are self-explanatory.

### Agent: Performance (prefix: F — not P, to avoid collision with priority tags)

Look for performance issues and optimization opportunities.

- Scan for unnecessary allocations in hot paths (e.g. building collections where iteration would do, redundant string copies).
- Check for algorithmic inefficiency (O(n²) where O(n) is possible, etc.).
- Look for unnecessary copies/clones where borrows, moves, or references would work.
- Check lock granularity and contention potential.
- Note any I/O patterns that could be batched or buffered.
- Check buffer/capacity sizing — are defaults reasonable? Is there unnecessary resizing?
- Flag any benchmarks that exist or should exist.

Don't flag micro-optimizations that don't matter at the project's scale. Focus on issues that would matter with realistic workloads.

### Agent: API Ergonomics (prefix: A)

Evaluate the public API surface for usability and safety.

- Is the API hard to misuse? Can invalid states be constructed?
- Are error types informative? Can callers distinguish failure modes they care about?
- Is the API consistent (naming, parameter order, return types)?
- Are there missing convenience methods that would reduce boilerplate for common use cases?
- Check standard trait/interface implementations: are expected capabilities (equality, hashing, serialization, debug printing, cloning) present where users would need them?
- Look for builder pattern opportunities, or builder patterns that aren't pulling their weight.
- Check for missing conversions/coercions that would improve interop with the ecosystem.
- Is the type-level API making good use of the type system? (parse-don't-validate, newtype wrappers, tagged unions over stringly-typed fields, etc.)

Don't suggest API changes that would bloat the surface area for hypothetical use cases.

### Agent: Correctness (prefix: C)

Audit for correctness and safety issues in the existing codebase.

- Check error handling: are errors silently dropped, swallowed, or logged-and-continued? Are there crash-on-error patterns (unwrap, assert, panic, throw-without-catch) in library/non-test code?
- Look for resource leaks: unclosed handles, missing cleanup on error paths, unbounded allocations.
- Verify thread/concurrency safety: data races, missing synchronization, lock ordering issues.
- Check for invariant violations: can public API calls put internal state into an invalid configuration?
- Audit unsafe or unchecked code blocks: are safety invariants documented? Is there a safe alternative?
- Look for TODOs/FIXMEs that flag known correctness concerns.

This is not a review of a diff — audit the code as it stands today.

## Step 3: Synthesize findings

Once all agents return:

1. Collect all findings, keeping dimension prefixes.
2. Sort by priority (P0 first, then P1, P2, P3).
3. Deduplicate: if two agents flagged the same issue, merge and keep the higher priority.
4. Present the combined analysis grouped by priority tier.
5. End with a summary: one line per dimension stating the main gap, plus an overall assessment of project maturity.
