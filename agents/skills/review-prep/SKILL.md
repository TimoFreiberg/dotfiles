---
name: review-prep
description: "Use when the operator needs to sign off on a change they didn't write line by line: their own branch before opening a PR, or someone else's PR"
---

Prepare the operator to sign off on a change. They don't read every line;
they need to know what they are approving and what the codebase will contain
afterwards. Don't post comments, edit code, or give a merge verdict.

Settle the scope first (PR URL, branch, or revset); ask if it's unclear. Read
the stated intent: the PR description, ticket, or plan. Then dispatch two jobs
in parallel, giving both the scope and the stated intent:

- **Findings:** reviewers with the thorough level's model group per
  @skill:review-levels, one per role (correctness, then style and
  maintainability); no repair rounds. Each finding has `file:line`, quoted
  code, and severity. For someone else's PR, draft each as a review comment
  the operator could post.
- **Brief:** one agent with `model_override: "mg:docs"`, writing for a
  reader who knows the product but not this change. Skip any section with
  nothing to say.
  1. What the change does, and where it differs from the stated intent.
  2. What the codebase now contains: new structure and flow, the
     assumptions it makes, and what someone will have to maintain.
  3. Sharp edges: surprises, new failure modes, behavior that changed
     silently.
  4. Anything beyond the stated intent.
  5. The few hunks worth reading yourself, ranked, with why.

Before presenting, note in the brief where a finding contradicts it. Present
the brief first, then the findings by severity. End with the questions the
operator still has to answer before signing off, and offer @skill:review-quiz
for any part they want to understand themselves.
