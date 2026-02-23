---
title: 'code-execution: fork a new child per invocation'
created: '2026-02-23T20:02:14.713771'
status: open
---

A new child is forked per call with jiti/register startup cost. A warm child process pool (size 1) with state reset between calls would cut latency.
