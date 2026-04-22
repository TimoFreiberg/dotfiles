---
name: review
description: Code review with scope selection. Use when the user wants to review code changes - uncommitted work, a specific commit, or a GitHub PR.
argument-hint: "[uncommitted | commit <revset> | pr <number> | branch <name> | file <path>] [--instructions \"...\"] [--model opus|sonnet|haiku|<id>]"
disable-model-invocation: true
allowed-tools:
  - Bash(uv run *)
---

Run the review script and print its stdout verbatim:

```
uv run $HOME/dotfiles/agents/skills/review/review.py $ARGUMENTS
```

The script handles diff gathering, parallel reviewer agents, verification, and
formatting. Your job is just to invoke it and surface the output.

**Rules:**

- Do not add commentary, summaries, or section headers around the script's
  output. Paste stdout as-is into your response.
- If the script exits non-zero, surface stderr so the user can see what broke.
- If `$ARGUMENTS` is empty, still invoke the script — it defaults to reviewing
  `trunk()..@` (the commits on the current branch).
- Valid subcommands: `uncommitted`, `commit <revset>`, `branch <name>`,
  `file <path>`, `pr <number>`. Anything else is passed through and the script
  will produce a usage error.

**Examples:**

- `/review` → `uv run .../review.py`
- `/review pr 50` → `uv run .../review.py pr 50`
- `/review commit abc123` → `uv run .../review.py commit abc123`
- `/review commit 'trunk()..@'` → `uv run .../review.py commit 'trunk()..@'`
- `/review --instructions "focus on XSS" pr 50` → as typed.
