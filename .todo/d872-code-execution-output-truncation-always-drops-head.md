---
title: 'code-execution: output truncation always drops head'
created: '2026-02-23T20:02:14.591214'
status: open
---

Output truncation currently keeps the tail and drops the head. For debugging errors early in a loop, losing the first N lines is confusing.

Fix: mirror the bash tool's truncation pattern. Write the full output to a temp file and return a truncated preview (head + tail) plus the temp file path. The model can read the file if it needs the full output.
