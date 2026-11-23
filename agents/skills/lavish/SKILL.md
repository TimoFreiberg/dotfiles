---
name: lavish
description: Use when the operator explicitly asks for an HTML or Lavish artifact, or when another skill such as review-prep says to present via Lavish.
license: MIT
---
<!-- Adapted from https://github.com/kunchenguid/lavish-axi/blob/main/skills/lavish/SKILL.md; see LICENSE. -->

Lavish presents agent-written HTML and Markdown in the workspace hub so the
operator can annotate it and send feedback without popping up standalone
browser tabs. Before building HTML, read `lavish-axi design`, each matching
`lavish-axi playbook <id>`, and `lavish-hub theme`. Build what you were asked
for; otherwise infer it from the conversation.

Use the Orangebox page and code/diff themes described by `lavish-hub theme`
by default, even if `lavish-axi design` suggests another theme. Follow an
existing project design system or an explicitly requested design instead.

Write the artifact in a directory of its own outside the repository, holding
only the artifact and its assets: Lavish serves sibling files to the browser.
Quote paths in shell commands. Don't share outside Lavish unless asked.

## Hub routing

Always publish through the workspace hub. Never open standalone pages with
`lavish-axi "<file>"` and never pass `--open` to `lavish-hub publish`:
artifacts should update the single hub review rather than popping up new
browser tabs.

Look for hub services this session started: page through `list_jobs` with
`show_type: ["shell_service"]` and `show_dead: true`.

- No active hub: load the `hub` skill and start one for the workspace before
  publishing. If starting a hub fails (for example, outside a jj workspace or
  another owner already holds it), stop and report it rather than opening
  standalone.
- One ready hub: publish there, so the session's work stays in one review.
- Several ready hubs: use the one the operator named, otherwise ask.
- A hub is starting or failing, or its readiness is unclear: report it and ask
  rather than starting another or opening standalone.

Use `job_status` and its logs to identify the service and workspace. A hub is
ready when its current attempt has passed its health check and printed
`Hub owner running for <workspace>`. Logs retain earlier attempts, so an old
startup line or `running` status alone isn't proof. If you can't establish
current readiness, ask. Don't read the hub's runtime metadata.

## Publishing to the hub

Set `LAVISH_HUB_WORKSPACE` to the selected service's workspace, using the
startup line or its feedback's `workspace` field. Quote it safely for the shell.

```sh
lavish-hub publish "<file>" --id <id> --title "<title>" --workspace "$LAVISH_HUB_WORKSPACE"
```

Leave out `--open` so publishing updates the hub without popping up a browser
tab. The file can be HTML or Markdown. Publishing selects the document in the
open review. IDs are 1–64 ASCII letters, digits, `_` or `-`, starting with a
letter or digit; `commits`, `changes` and `tasks` are reserved. Use a new ID
per artifact and reuse it only to update that artifact.

After editing HTML, republish it with the same ID and ask the operator to
reload after saving their edits; the reload warning can miss custom editors.
Markdown updates automatically and can be edited from the page, so reread it
before changing it.

Feedback and replies go through the `hub` skill. Use `lavish-hub` for hub
pages — never standalone `lavish-axi`, which runs a different server and opens
a separate browser tab. Ending the hub's review stops the hub.
