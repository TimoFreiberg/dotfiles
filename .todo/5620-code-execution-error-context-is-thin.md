---
title: 'code-execution: error context is thin'
created: '2026-02-23T20:02:14.885172'
status: open
---

Only e.message is sent back on throw. A stack trace mapped to model code lines would help self-correction. new Function wrapper makes line numbers predictable (line - 2 offset).
