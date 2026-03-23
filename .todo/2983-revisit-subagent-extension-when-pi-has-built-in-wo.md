---
title: Revisit subagent extension when pi has built-in worktree support
created: '2026-03-23T11:20:24.434834'
status: open
---

The subagent extension was removed (jj change kkno) because autonomous subagent spawning lost context — the parent session only got summaries, not full context. With a 1M context window, that tradeoff rarely makes sense.

Parallel writing without worktree isolation is also a footgun (conflicts, partial states). Once pi or jj worktrees are natively supported, parallel implementation tasks become viable and worth revisiting.

Find the deleted code: jj show kkno --git
