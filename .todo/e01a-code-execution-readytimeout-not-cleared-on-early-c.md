---
title: 'code-execution: readyTimeout not cleared on early crash'
created: '2026-02-23T20:02:14.548036'
status: open
---

If the child crashes before sending ready, both readyTimeout and exit handler race to call finish. settled protects, but the dangling timer is sloppy. Clear readyTimeout in the exit handler.
