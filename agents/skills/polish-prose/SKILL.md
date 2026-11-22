---
name: polish-prose
description: "Use when handing prose to the docs model group: polishing the comments, docs, and commit messages in a range, or drafting or rephrasing a single piece such as a review comment, ticket description, or brief."
---

Give a writer subagent (`model_override: "mg:docs"`) the text and tell it who
will read it, where, and what they already know ("the PR author, who wrote
this code", "a colleague who knows the product but not this change"). Leave
length and style to the writer. Don't add your own guesses about what the
reader lacks. The writer aims for first-pass comprehension—establishing
context before implementation details and explaining why any risk matters so
the reader doesn't have to reconstruct background—checks every claim it keeps
against the code, and follows the `deslop` skill (including its voice file).

For a range (default: the current change), the writer polishes its comments,
docs, and commit messages. Their reader knows the product but not this work.

Then a reviewer (`model_override: "mg:review_thorough"`) checks the result:
would its reader understand each piece on a first pass without reconstructing
context, does it use the codebase's own terms, is anything false, and what
could the reader do without? Send its findings back to the writer with
`resume_from`. Stop when the reviewer has nothing material, or after two
rounds.
