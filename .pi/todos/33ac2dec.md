---
id: 33ac2dec
title: "[P2] LSP client: notify()/send() writes to stdin without liveness guard"
tags: [lsp, p2, bug]
status: done
created_at: "2026-02-15T21:59:47.183Z"
---

**File:** `agents/extensions/lsp/client.ts`

## Problem

`request()` (line 165) checks `this.proc?.stdin?.writable` before writing, but `notify()` → `send()` uses `this.proc!.stdin!.write(...)` unconditionally. If the LSP server has exited, the `on("exit")` handler (line 46) sets `initialized = false` but doesn't null `proc`, so `send()` writes to a closed stream or throws.

Affected callers: `ensureOpen`, `refreshDocument`, `didClose`, the `initialized` notification.

## Agreed approach

1. **Null `proc` in the `on("exit")` handler** (line 46), consistent with `stop()` (line 91) which already does this. Makes state truthful: server gone → `proc` is `null`.

2. **Add a writable guard to `send()`** — the central chokepoint for all writes. Have `send()` return a boolean (or throw) so callers can react:
   - `notify()`: silently drops the message (fire-and-forget; the user/LLM will notice the server is gone without extra error spam).
   - `request()`: rejects the promise. Can remove its own redundant guard since `send()` now handles it, but still needs to clean up the pending entry and reject on a failed send.

3. **No logging or error surfacing on silent drops** — both the LLM and human will notice the server is gone from other signals.
