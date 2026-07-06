---
name: debug
description: Use when a bug, unexpected behavior, or failing flow needs explaining — traces the code path end-to-end before forming any hypothesis.
argument-hint: "<description of the bug or unexpected behavior>"
---

The user wants you to investigate a bug or unexpected behavior. Follow this
process strictly — do not skip steps or jump to conclusions.

## Step 1: Scope the investigation

Read the user's description. Identify:
- **Entry point**: where execution begins (request handler, CLI entrypoint, test, etc.)
- **Expected endpoint**: what should happen
- **Actual behavior**: what happens instead (error, hang, wrong result, etc.)

If any of these are unclear, ask before proceeding.

## Step 2: Trace the full code path

Starting from the entry point, trace every function call, branch, and early
return on the path to the expected endpoint. Read each file — do not assume
what a function does from its name. Trace project code; stop at
library/framework boundaries unless the evidence points inside them.

For each function in the chain, note:
- Error handlers: do they exist? Are they reachable? Do they propagate or swallow?
- Timeouts and deadlines: are they set? What happens when they fire?
- Early returns and guards: what conditions cause the path to diverge?
- Shared state: locks, atomics, channels — who else touches them?

Use sub-agents to trace branches in parallel when the path forks.

## Step 3: Form a hypothesis

Only after completing the trace, state your hypothesis:
- What specifically goes wrong, with file:line references
- Why the current code allows it
- What evidence supports this over alternative explanations

If you're uncertain about any link in the chain, say so explicitly. Do not
speculate or fill gaps with assumptions.

## Step 4: Suggest fixes

Propose both minimal fix and the cleanest fix that matches the existing design and architecture best.
Explain:
- What it changes and why
- What it does NOT change (scope boundaries)
- How to verify it works (test command, reproduction steps)

Do not implement the fix unless the user asks you to — the deliverable of
this skill is the diagnosis; fixing is a separate decision.
