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

Start or resume the session with `lavish-kit "<file>"` (HTML or markdown)
instead of `lavish-axi` directly; `lavish-kit --help` lists its commands.
Its output names the page file for `reply` and `end`. Every command returns;
the page's worker watches changing sources until the Lavish session ends.
There is no `--watch` option, and opening a page needs no background job.
Generated pages default to `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-kit/pages/`;
`--out` overrides this and must be outside the reviewed repository.

Inside herdr (`HC_TERMINAL_ID` set), lavish-kit delivers feedback to your
session automatically, even when Artifacts registration fails. Do not poll
those pages. Answer with `lavish-axi reply "<page>" --agent-reply "..."`.
After a user save notice, reread the source file before making edits. If the
session is gone, feedback stays in the page's outbox until the operator runs
`lavish-kit retarget "<page>" [--terminal T]`.

Follow lavish-kit's feedback line: a running delivering worker keeps automatic delivery on outside-herdr reopen; otherwise it says to poll.
When it says to poll, run `lavish-axi poll "<page>"` with `shell_exec`,
`background: true`, a descriptive job name, and the longest supported explicit
`timeout_seconds`. Its completion wakes this agent; don't block on it. If it
times out, restart it. Don't pass Lavish's `--timeout-ms`. Quote artifact paths
in shell commands. Don't share or publish unless the operator asks.

Build what you were asked for; otherwise infer it from the conversation.
