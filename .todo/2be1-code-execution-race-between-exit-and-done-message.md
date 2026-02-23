---
title: 'code-execution: race between exit and done message'
created: '2026-02-23T20:02:14.499576'
status: open
---

If the child sends done and then exits, the exit handler could fire before the message handler depending on event loop ordering. settled flag protects against double-resolve, but exit handler could win and misreport an error for a successful run. Consider deferring the exit handler or giving message priority.
