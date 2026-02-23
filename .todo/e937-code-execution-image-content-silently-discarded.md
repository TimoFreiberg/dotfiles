---
title: 'code-execution: image content silently discarded'
created: '2026-02-23T20:02:14.620392'
status: open
---

extractText filters out image content entirely. If a tool returns an image (e.g., read on a PNG), the model gets an empty string with no indication content was dropped. Add a placeholder or warning.
