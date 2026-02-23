---
title: 'code-execution: console not fully sandboxed'
created: '2026-02-23T20:02:14.331085'
status: open
---

Model code can bypass console capture via globalThis.console or by capturing console before the Function scope runs. Consider freezing/overriding globalThis.console in the child before execution.
