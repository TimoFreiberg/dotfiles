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

Open or resume a session with `lavish-kit "<file>"` (HTML or Markdown) instead
of calling `lavish-axi` directly. `lavish-kit --help` lists its commands. The
command returns right away and names the page file to use with `reply` and
`end`. The page's worker keeps it up to date until the Lavish session ends, so
there's no `--watch` option or background job to run. Generated pages are
written under `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-kit/pages/`, and an
HTML file opens where it is. `--out` overrides both and must be outside the
reviewed repository.

lavish-kit then prints whether feedback is delivered automatically or needs
polling. Follow that line. With automatic delivery (inside herdr), feedback
arrives as a message in your session. Don't poll the page, and answer with
`lavish-axi reply "<page>" --agent-reply "..."`. After a notice that the user
saved a file, reread it before editing. If delivery fails, the page says so
and keeps the feedback until someone runs
`lavish-kit retarget "<page>" [--terminal T]`.

When the line says to poll, run `lavish-axi poll "<page>"` with `shell_exec`,
`background: true`, a descriptive job name, and the longest supported explicit
`timeout_seconds`. Its completion wakes this agent; don't block on it. If it
times out, restart it. Don't pass Lavish's `--timeout-ms`. Quote artifact paths
in shell commands. Don't share or publish unless the operator asks.

Build what you were asked for; otherwise infer it from the conversation.
