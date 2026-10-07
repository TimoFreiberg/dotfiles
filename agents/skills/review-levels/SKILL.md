---
name: review-levels
description: "Review level rubric (routine, thorough, critical) shared by planning and orchestration."
---

Judge the review level by risk, not size.

- **routine**: local, low-risk, easy-to-see correctness: docs, config,
  mechanical edits, a contained fix with a direct test. Model group
  `review_routine`; one reviewer covering everything; 2 rounds.
- **thorough**: everything else, including public interfaces, persisted or
  wire formats, concurrency, security, and error-handling policy. Model group
  `review_thorough`; one reviewer per role; 4 rounds.
- **critical**: only when the operator explicitly asks. Model group
  `review_critical`; correctness reviewed once per model in the group
  (`count` = number of candidates), other roles once; 4 rounds.
