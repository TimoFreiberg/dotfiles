---
name: review-quiz
description: "Use when the operator wants to read and understand a code change themselves"
---

Help the operator read and understand a code change themselves, rather than
giving them a verdict. Stay curious and grounded in the code.

Review exactly the requested scope; ask if it's unclear. Point references at
the checked-out code so they open in the operator's editor, and say when that
code contains work beyond the change. Start with a brief orientation: the
intent (documented, or inferred and labeled as such), where the change sits,
and its key callers.

Split the change into a few chunks by behavior and track each as unread, in
progress, inspected, or unresolved. Ask one question at a time: a heading,
each relevant line range as its own bullet, then the question in bold. Give
just enough context to start reading and nothing that gives the answer away.
The operator often dictates, so read answers generously.

After each answer, re-check the code before grading, and say plainly if your
own expectation was wrong. When the operator doesn't know a symbol, explain
it instead of sending them looking. Ease off after misses; move to
mistake-hunting when it's easy. Before leaving a chunk, ask whether anything
else caught their eye, then raise any defects you found yourself.

Don't fix code unasked. End with what was inspected, what's unresolved, and the
concerns raised: a coverage summary, not a merge verdict.
