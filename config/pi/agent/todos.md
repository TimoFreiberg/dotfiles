# Pi Agent: Claude Code Feature Parity

Porting useful Claude Code niceties into Pi via extensions, skills, and config.

Source code reviewed at `~/src/pi-mono` — implementation notes below reflect
the actual extension API surface, hook system, and tool pipeline.

## Known features to port

### 1. Read call minification
**Status:** todo
**Impl:** extension (`tool_result` hook) + system prompt guidance

Pi's read tool (`coding-agent/src/core/tools/read.ts`) processes each call
independently — no merging. Two angles:

- **Output minification:** use `pi.on("tool_result", ...)` to strip redundant
  content from read results (e.g. compress blank lines, collapse boilerplate).
  The hook chain lets each extension mutate `{content, details, isError}`.
- **Call merging:** can't actually merge calls pre-execution — `tool_call` hook
  can only block, not batch. Best approach: system prompt instruction telling
  the model to prefer larger offset/limit ranges and avoid sequential reads of
  adjacent lines. Could also use `context` hook (called before every LLM call)
  to post-hoc merge adjacent read results in the message history.

### 2. Bash output truncation
**Status:** todo
**Impl:** extension (`tool_result` hook on bash calls)

Pi's bash tool (`coding-agent/src/core/tools/bash.ts`) currently keeps the
**last** 2000 lines via `truncateTail()`. The ask is the opposite: show only
the **first 3 lines** in context, with the full output available on expand.

Use `pi.on("tool_result", handler)` — check if the tool is `bash`, then replace
`content` with the first 3 lines + a note like `[N more lines, full output in
/tmp/pi-bash-xxx.log]`. The temp file path is already included when output
exceeds 50KB; for shorter output, we'd need to write it ourselves or just keep
it in memory behind compact-output's Ctrl+O toggle.

### 3. Subagent support for review skill
**Status:** todo — **bigger lift than expected**
**Impl:** custom tool (extension) that creates new `Agent` instances

**Pi has no built-in subagent system.** The `scout.md` and `worker.md` files in
`agents/agents/` are persona definitions, but there's no framework-level spawn
mechanism, message passing, or result-return protocol.

The `mom` Slack bot (`packages/mom/`) shows how to create a secondary `Agent` +
`AgentSession` using the SDK, but it's manual wiring. To get subagents working
for the review skill, we need:

1. A `spawn_agent` tool (registered via extension) that creates a new `Agent`
   instance with its own context window, runs it to completion, and returns the
   result as the tool's output.
2. The tool should accept: persona (path to agent .md), prompt, allowed tools,
   and model override.
3. Wire it into the review skill so it can fan out file subsets to parallel
   workers.

This is the single largest item. Consider asking Mario if subagent support is
on his roadmap — it may be better to wait for a first-class API than to build
a fragile extension-level workaround.

### 4. Memory system (auto-memory extension)
**Status:** todo
**Impl:** extension, compatible with Claude Code's auto-memory spec

Pi has no built-in memory. The extension API provides the right hooks:

- **Loading:** `pi.on("before_agent_start", handler)` can prepend messages and
  replace the system prompt. Inject `MEMORY.md` + referenced memory files here,
  similar to how Claude Code uses `system-reminder` blocks.
- **Saving:** register a `save_memory` tool via `pi.registerTool()`. The tool
  writes the memory file + updates `MEMORY.md`. The model calls it when it
  decides to save (guided by system prompt instructions).
- **Storage:** same `memories/` dir and `MEMORY.md` index that Claude Code uses
  (`~/dotfiles/claude/memories/`), so both agents share the same memory store.
- **Format:** same frontmatter schema (`name`, `description`, `type` fields),
  same memory types (user, feedback, project, reference).

Pattern reference: `packages/mom/src/agent.ts` line 69 shows `MEMORY.md`
injection into a system prompt.

### 5. Compaction control
**Status:** todo
**Impl:** extension (hooks already exist)

Pi's compaction system (`coding-agent/src/core/compaction/compaction.ts`) already
supports `customInstructions` on `generateSummary()` and the
`session_before_compact` hook lets extensions fully replace or cancel compaction.

What's needed:
- A `/compact` command (extension) that calls `ctx.compact({customInstructions})`
  with an optional focus argument.
- Support for a "Compact Instructions" section in AGENTS.md, parsed at
  compaction time and passed as `customInstructions`.
- Minimal work — the API surface is already there.

## Nice-to-have (lower priority)

- **Task tracking** — `TaskCreate`/`TaskUpdate`/`TaskGet` tools for breaking
  work into trackable steps that survive compaction; shared across sessions
- **Deferred tool loading** — all tool schemas load upfront currently; lazy
  loading would need changes in `createAllToolDefinitions()` or the
  `wrapToolDefinition()` pipeline — likely needs core support from Mario
- **`/btw` side questions** — ask something mid-task without polluting
  conversation history; runs against current context, no tool access, dismissible
  overlay
- **Session forking** — already supported in Pi's session tree structure
  (`session-manager.ts`), just needs UX exposure
- **Selective rewind** — per-prompt granularity, restore code only / conversation
  only / both
- **Background bash** — Ctrl+B to move a running command to background
- **Prompt suggestions from git history** — grayed-out suggestion derived from
  recent git activity
- **`!` bash prefix** — Pi already has this via the `user_bash` event hook
- **Hook `if` filtering** — lightweight pattern match to skip hook invocation

## Open questions

- Should the memory extension live in `agents/extensions/` (shared) or be
  Pi-specific? Leaning shared since the format is agent-agnostic.
- Subagents: is Mario planning first-class support? Building it as an extension
  is possible but fragile — creating `Agent` instances inside a tool call means
  managing nested event loops, cancellation, and context isolation manually.
- For read call merging via the `context` hook: is mutating the message history
  before each LLM call safe, or does it interfere with session persistence?
  The `context` hook returns new messages but the original persisted messages
  should be untouched — need to verify.
