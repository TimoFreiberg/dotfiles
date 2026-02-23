---
title: 'code-execution: new Function is not a real sandbox'
created: '2026-02-23T20:02:14.373834'
status: open
---

The child is a separate OS process, so memory and crash isolation from pi is real. The actual concern is narrower: model code can use Node built-in APIs (fs, child_process, net, etc.) directly, bypassing pi's tool-level controls (permission prompts, logging, hashline verification, audit trail). This is not a privilege escalation (same OS user), but it means tool-layer restrictions (e.g., a future allowlist/denylist per b11b) could be circumvented. Non-issue if you don't rely on tool-level gates; relevant if you do.
