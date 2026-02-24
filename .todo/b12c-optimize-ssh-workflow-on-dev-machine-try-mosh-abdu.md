---
title: 'Optimize SSH workflow on dev machine: try mosh + abduco'
created: '2026-02-21T23:18:09.461745'
status: done
done_at: '2026-02-24T19:58:33.02787'
---


SSH connection drops 2-3x/day, making agent usage painful (especially scrolling history in tmux).

Plan:
1. Install mosh on both local and remote — keeps connection alive across network changes
2. Replace tmux with abduco for session persistence — no terminal rendering quirks, native scrollback
3. Keep tmux as fallback safety net if needed

Optional further exploration:
- Pi SDK server mode: run agent remotely, connect TUI locally for native UX
