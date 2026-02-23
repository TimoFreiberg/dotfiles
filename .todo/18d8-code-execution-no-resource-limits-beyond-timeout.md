---
title: 'code-execution: no resource limits beyond timeout'
created: '2026-02-23T20:02:14.931366'
status: open
---

## Problem

Three unbounded resource dimensions in code-execution beyond the existing 5-minute timeout:

1. **IPC call count** — tool_call handler in index.ts unconditionally dispatches pi.callTool() with no counter. A model loop over 10k items issues 10k real I/O tool calls.
2. **Child heap memory** — fork() sets no --max-old-space-size; child inherits ~4 GB default. Model code allocating large structures could consume excessive memory.
3. **Output buffer in child** — stdout[] array in child-executor.ts grows unbounded. Heavy logging in a loop can OOM the child before it sends done. Parent-side truncateOutput only runs after receiving the full buffer.

## Decisions

- **Max tool calls**: 500 per execution (default), configurable via extension config.
- **Child memory limit**: 512 MB (--max-old-space-size=512 in execArgv).
- **Child output buffer cap**: 20 MB. Drop oldest lines when exceeded. Keeps child alive even under heavy logging.
- **Limit behavior**: Soft signal, not hard kill. When call limit is hit, parent sends an IPC message (e.g. { type: "limit_exceeded" }). Child rejects the pending tool call promise with an error. Model code can catch it or not — either way, execute()'s try/catch in child-executor.ts captures it and sends done with partial stdout + error message. Clean JS stack trace, no OS signals.

## Implementation

### index.ts

1. Add config constants (with the existing ones near line 43):
   - MAX_TOOL_CALLS = 500
   - CHILD_MAX_OLD_SPACE_MB = 512
2. In fork() execArgv (line 114), add "--max-old-space-size=512".
3. In the tool_call message handler (line 154), check tracker.calls.length >= MAX_TOOL_CALLS before dispatching. If exceeded, send { type: "limit_exceeded", reason: "..." } to child instead of calling pi.callTool().

### child-executor.ts

1. Add MAX_OUTPUT_BYTES = 20 * 1024 * 1024 constant.
2. In capturedConsole.log (and warn/error/info), track cumulative byte size. When exceeded, stop pushing to stdout[] (silently drop or push a single truncation notice).
3. Add a message handler for type: "limit_exceeded" that rejects the pending call promise with a descriptive Error.

### Acceptance criteria

- [ ] Model code hitting 500 tool calls gets a catchable error with partial output returned
- [ ] Child process runs with --max-old-space-size=512
- [ ] Child output buffer stops growing past 20 MB, adds truncation notice
- [ ] All three limits are configurable constants at the top of their respective files
- [ ] Existing tests (if any) still pass; add test for call-count limit

## Related TODOs

- e11e (sandbox) — broader security; resource limits are one facet
- b11b (allowlist/denylist) — restricting which tools complements restricting how many calls
- d667 (child pool) — pool design must account for per-invocation resource limits
