---
name: review-prep
description: "Use when the operator needs to sign off on a change they didn't write line by line: their own branch before opening a PR, or someone else's PR"
---

Prepare the operator to sign off on a change. They don't read every line;
they need to know what they are approving and what the codebase will contain
afterwards. Don't post comments, edit code, or give a merge verdict.

Settle the scope first (PR URL, branch, or revset) and read the stated intent:
the PR description, ticket, or plan. Then dispatch two jobs in parallel:

- **Findings:** reviewers at the thorough level per @skill:review-levels
  (correctness, then style and maintainability), each finding with
  `file:line`, quoted code, and severity. For someone else's PR, draft each
  as a review comment the operator could post.
- **Brief:** one agent with `model_override: "mg:docs"`, writing for a
  reader who knows the product but not this change:
  1. What the change does, in a few sentences, and where it differs from
     the stated intent.
  2. Architecture: what's new or changed, how data and control flow
     through it, and the interfaces, ownership, and lifetimes it adds.
  3. Assumptions it makes about callers, configuration, upstream
     systems, concurrency, and rollout.
  4. Sharp edges: surprising behavior, new failure modes, behavior that
     changed silently, things that will matter during canary.
  5. What the codebase now contains that someone will have to maintain:
     parameters, metrics, logs, invariants.
  6. Anything beyond the stated intent: extra features, workarounds,
     tests nobody asked for.
  7. The few hunks worth reading yourself, ranked, with why.

Present the brief first, then the findings by severity. End with what is
left before the operator can sign off, and offer @skill:review-quiz for any
part they want to understand themselves.
