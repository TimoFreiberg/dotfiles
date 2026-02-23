---
title: 'code-execution: no stderr capture'
created: '2026-02-23T20:02:14.414328'
status: open
---

stdio is piped but stdout/stderr from the child's pipes are never read. Native writes to process.stdout/stderr (e.g., from spawned subprocesses) are silently lost. Wire up child.stdout and child.stderr listeners.
