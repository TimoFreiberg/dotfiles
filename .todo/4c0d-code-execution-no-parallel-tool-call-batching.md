---
title: 'code-execution: no parallel tool call batching'
created: '2026-02-23T20:02:14.646219'
status: open
---

Each await callTool() blocks sequentially. Promise.all works but IPC doesn't batch. A callTools(calls[]) batch message could reduce round-trips for parallel operations.
