---
name: lavish
description: Use when the operator explicitly asks for an HTML or Lavish artifact, or when another skill such as review-prep says to present via Lavish.
license: MIT
---
<!-- Adapted from https://github.com/kunchenguid/lavish-axi/blob/main/skills/lavish/SKILL.md; see LICENSE. -->

lavish-axi opens agent-written HTML in the browser so the operator can
annotate it and send feedback back to you. It is installed globally via mise.

Workflow, design, and playbook guidance live in the CLI, not here. Before
building, read:

- `lavish-axi --help`: commands and the review loop
- `lavish-axi reply --help`: hand back a result and exit, instead of polling again
- `lavish-axi design`: design direction and snippets
- `lavish-axi playbook` lists ids; `lavish-axi playbook <id>` gives focused guidance

Start or resume the session with `lavish-view "<file>"` (HTML or markdown)
instead of `lavish-axi` directly. Its output line names the page file to pass
to `lavish-axi poll`, `reply`, and `end`. Run every poll with `shell_exec`,
`background: true`, a descriptive job name, and an explicit `timeout_seconds`
set to the longest timeout supported by the current harness. Never use a
shorter or default timeout, or pass Lavish's `--timeout-ms`. If a poll times
out before feedback arrives, restart it with the longest supported timeout.
Its completion wakes this agent; don't block on it. Quote artifact paths in
shell commands. Don't `share` or publish unless the operator asks.

Build what you were asked for; otherwise infer it from the conversation.
