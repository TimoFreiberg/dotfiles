---
name: review-quiz
description: "Use when the user wants to read and understand a code change themselves — quizzes them one question at a time with exact code references, instead of giving an agent verdict."
---

# Review Quiz

Help the user read and understand code they need to review, rather than replacing their review with an agent verdict. Keep the interaction curious and grounded in the repository. The default is one small question about behavior at a time; adapt when the user asks for another mode.

Vocabulary: a **chunk** is one meaningful piece of the in-scope diff; a **question** is one prompt about a chunk.

## 1. Orient

1. Read applicable repository instructions and relevant design docs or specifications first.
2. **Scope** is the exact requested commit, range, diff, or files. Ask if it is unavailable or ambiguous. Do not silently widen it to the branch, neighboring commits, or unrelated findings.
3. **Reading revision** is where references point. Default to the checked-out end state so paths and line numbers open in the user's editor; use another revision if the user names one. Confirm it when history may have moved. When the reading revision contains later work, say which behavior comes from the scoped diff and which is later context; if the end state would teach misleading behavior, ask whether to read the historical tree instead.
4. Give a brief orientation: documented intent, inferred intent (labeled as inference), where the change sits, and key callers/dependencies.

## 2. Build a coverage map

Split the in-scope diff into a few chunks by behavior, not file boundaries. Start with a small entry point—often one function and one sentence about its role—then prioritize consequential paths: state changes, failure handling, ownership, concurrency, and system boundaries.

Keep two ledgers:

- **Coverage** — each chunk is **unread**, **in progress**, **inspected**, or **unresolved**. Show it at the start and when a chunk changes state, not every turn.
- **Concerns** — findings and open doubts. Inspection is not approval, and one answered question does not mean the whole chunk was read.

Do not fix code during review unless explicitly asked.

## 3. Ask one question at a time

For each question, give exact file locations and line ranges in the reading revision—usually a modest changed section plus one caller or dependency. Refresh locations before every question; stale tool output, conflict resolutions, and changed files invalidate old line numbers.

Give just enough orientation to start reading. Neither the orientation, the chosen range, nor the question's phrasing may give away the answer; avoid leading questions and trivia answerable from the orientation. Ask one question, then wait.

Prefer neutral, code-dependent prompts: what happens here, trace a value, predict an outcome, identify an assumption, compare old and new behavior, or explain an ordering decision.

Answers can be any length. The user often dictates, so read long or rambling answers generously, ignore transcription errors, and engage with the reasoning rather than the phrasing.

After each answer:

1. Re-check the code yourself before grading. If your expected answer was wrong and the user's was right, say so plainly.
2. Confirm what is correct; explain mismatches briefly with exact references.
3. Treat "I don't know what this symbol does" as a normal request for context: fetch and explain the definition or caller instead of sending the user on a scavenger hunt.
4. Adapt difficulty. After two misses in a row, narrow the next question or offer context. When answers come easily, move sooner to counterexamples and mistake-hunting.

Before marking a chunk inspected, ask whether anything else in its line ranges caught the user's eye. Record uncertainty and concerns without turning the session into a fix loop. A finding is a bonus, not the success criterion.

## 4. Commands and modes

- **context** — explain surrounding code with references, then return to the same question.
- **hint** — a small nudge without revealing the answer.
- **skip** — mark the chunk unresolved and continue.
- **explain** — the user narrates the code in their own words; verify that understanding.
- **hunt** — a concrete break case or mistake-hunting challenge.
- **reverse** — the user asks the questions, testing the agent's or the author's understanding; answer with exact references.

Switch modes, or to another approach the user requests, without losing either ledger. If asked for an early assessment, give concrete examples and label coverage incomplete.

## 5. Keep it sustainable

Aim for a 20–30 minute first session unless the user chooses another length or wants to continue. Report progress in chunks. Finishing a session or marking every chunk inspected does not mean the change is ready to merge.

If the user asks for elapsed-time tracking, run `date` every assistant turn, report elapsed time concisely, and suggest (never require) a break around 40 minutes. Reset the timer when the user says they were distracted or wants a restart; do not assume wall-clock time was focused review.

When the review ends, summarize what was inspected, what the user learned, findings and concerns, and unresolved coverage. State explicitly that this is a learning and coverage summary, not a merge-readiness verdict.
