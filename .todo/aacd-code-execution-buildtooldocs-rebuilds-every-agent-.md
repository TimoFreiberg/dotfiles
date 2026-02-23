---
title: 'code-execution: buildToolDocs rebuilds every agent start'
created: '2026-02-23T20:02:14.986021'
status: open
---

If tools don't change mid-session, docs could be cached. If extensions register tools lazily, docs could be stale. A pi.on('tools_changed') hook or lazy rebuild would be more correct.
