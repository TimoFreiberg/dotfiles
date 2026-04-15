---
title: Script the dev-review-loop orchestrator
created: '2026-04-15T09:48:35.568679'
status: open
---

Replace parts of the dev-review-loop skill's LLM orchestration with a deterministic script.
Test-drive the current skill-only version first to identify actual pain points.

## Design (from 2026-04-15 discussion)

**Architecture:** Script as a tool inside Claude Code (not standalone CLI).
The orchestrator agent calls the script to get next instructions, invokes
Agent/SendMessage/Skill as directed, and relays formatted summaries.

**What the script handles:**
- State machine: phase tracking, round counter, max-round enforcement
- VCS ops: detect jj/git, record base rev, commit-if-changed, gather cumulative diff
- Prompt templating: construct each subagent prompt with slots (task, diff, findings file paths)
- Output parsing: read structured JSON from subagent output files, branch on verdict/status
- File management: create/clean up the session directory

**What stays as LLM work:**
- Invoking Agent/SendMessage/Skill tools
- Relaying summaries to the user
- Gap deduplication (or just send both lists, let dev agent cope)

**Subagent output routing:** No built-in mechanism to redirect Agent output to files.
Subagents are instructed via prompt to write structured output to files and return
a short summary. Works but depends on subagent compliance.

**State files:** Live in .jj/dev-loop/<session-id>/ (or .git/dev-loop/...).
Project-local, durable across reboots, invisible to VCS. Cleaned up when loop finishes.

**Review integration:** /review output stays in orchestrator context for now.
Modifying /review for file-based output is a separate task.

## Open questions

- Observability: how to keep the user informed via Claude Code UI when
  the orchestrator doesn't read full outputs. Script could format summaries
  from structured files for the orchestrator to print verbatim.
- Whether prompt-based 'write to file, return summary' is reliable enough
  or needs a harder guarantee.
- Language choice: Python, TypeScript (Bun), or Rust.
- Actual pain points from test-driving the current skill may reshape the design.
