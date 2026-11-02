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

Run each poll with `shell_exec` and `background: true`, using a descriptive
job name. Its completion wakes this agent; don't block on it before handing
the page to the operator. Quote artifact paths in shell commands. Don't
`share` or publish unless the operator asks.

Build what you were asked for; otherwise infer it from the conversation.
