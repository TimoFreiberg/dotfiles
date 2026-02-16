---
id: 33ac2dec
title: "[P2] LSP client: notify()/send() writes to stdin without liveness guard"
tags: [lsp, p2, bug]
status: open
created_at: "2026-02-15T21:59:47.183Z"
---

**File:** `agents/extensions/lsp/client.ts:181-188`

`request()` checks `this.proc?.stdin?.writable` before writing, but `notify()` → `send()` does `this.proc!.stdin!.write(...)` unconditionally. If the server has exited (the `exit` handler sets `initialized = false` but doesn't null `proc`), `notify` will throw or write to a closed stream. This affects `ensureOpen`, `refreshDocument`, `didClose`, and the `initialized` notification.

**Fix:** Add the same writable guard to `send()`, or null out `proc` on exit.
