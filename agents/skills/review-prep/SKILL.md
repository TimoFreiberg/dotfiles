---
name: review-prep
description: "Use when the operator needs to sign off on a change they didn't write line by line: their own branch before opening a PR, or someone else's PR"
---

Prepare the operator to sign off on a change. They don't read every line;
they need to know what they are approving and what the codebase will contain
afterwards. Don't post comments, edit code, or give a merge verdict.

Settle the scope first (PR URL, branch, or revset); ask if it's unclear.
Check out someone else's PR in a jj workspace so references point at real
code. Read the stated intent if there is one: the PR description, ticket, or
plan. Then dispatch two jobs in parallel, giving both the scope, the checkout,
and any stated intent:

- **Findings:** reviewers with `model_override: "mg:review_thorough"`, one
  per role. Correctness: does it do what it claims, is it wired up and
  reachable, would the tests fail if the behavior broke? Leanness: are we
  going galaxy-brained? Flag machinery, config, defensive code, and tests the
  change doesn't need. Each finding has `file:line`, quoted code, a severity
  (critical/high/medium/low), and a draft review comment the operator could
  post.
- **Brief:** one agent with `model_override: "mg:docs"`, writing for a
  reader who knows the product but not this change. Skip any section with
  nothing to say.
  1. What the change does, and where it conflicts with the stated intent.
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
