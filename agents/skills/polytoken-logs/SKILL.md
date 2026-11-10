---
name: polytoken-logs
description: "Where Polytoken keeps session transcripts, tool output, and daemon logs on disk. Invoked by the operator only."
polytoken:
  disable_model_invocation: true
---

The operator wants you to look at Polytoken's own on-disk data. Everything
lives under `$HOME/.local/share/polytoken/`. Your system prompt has the
current session ID and daemon PID; use them unless the operator names
another session.

## Sessions: `sessions-v1/<session-id>/`

- `session.json`: project path, creation and last-activity times, initial
  model and facet, inferred title, parent session (subagents point at their
  parent), and a preview of the last user message. Read this first to find
  the right session.
- `log.jsonl`: the transcript, one JSON entry per line, with facet and
  model recorded on each entry. It can be large, so filter with `jq` or
  `grep` instead of reading it whole.
- `shell/<tool-call-id>.stdout|.stderr`: full output of each shell call,
  including what was cut from the tool result.
- `tool-results/`, `attachments/`: large tool results and attached files.
- `record.json`, `startup.json`: the daemon's PID and port.
- `credential.json`: secret. Never read or print it.

To find a session, run `ls -t sessions-v1 | head` for the most recent, or
grep the `session.json` files for a project path or title.
`sessions/`, `sessions-migration/` and `public-spool/` hold older formats;
look there only if a session is missing from `sessions-v1/`.

## Daemon logs: `logs/`

- `<UTC-start-time>-<pid>.log`: one log per daemon process. The current
  one ends in your daemon PID.
- `<UTC-start-time>-<pid>.liveness.jsonl`: liveness heartbeats.

There are thousands of these. Pick by PID or with `ls -t logs | head`, then
grep for the error or time window instead of reading a whole log.

## Other

`artifacts/` holds generated HTML (Lavish reviews, plans, diffs).
`auth/` holds MCP auth state: don't read it.

Treat all of this as read-only.
