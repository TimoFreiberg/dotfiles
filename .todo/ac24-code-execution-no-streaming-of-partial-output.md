---
title: 'code-execution: no streaming of partial output'
created: '2026-02-23T20:02:14.671725'
status: open
---

Model gets nothing until code finishes. For long-running scripts (minutes), streaming console.log lines back via onUpdate would give visibility and let the user cancel earlier with partial results.
