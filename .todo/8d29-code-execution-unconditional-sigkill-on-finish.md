---
title: 'code-execution: unconditional SIGKILL on finish'
created: '2026-02-23T20:02:14.45474'
status: open
---

child.kill('SIGKILL') fires on every finish, even after successful exit. Harmless but sloppy. Check child.killed or child.exitCode before killing.
