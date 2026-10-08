---
name: note
description: "Use when the operator says `note: …` or asks to jot something down for later: capture it into the mydesk TODO inbox and get back to work."
---

Append the note as one line at the end of the `# Inbox` section of
`$HOME/mydesk/TODO.md` (create the section at the end of the file if it's
missing):

    - [ ] <the operator's words>  ·<repo> ·<MM-DD>

Keep the operator's wording. Add a few words of context only when the line
would be unreadable a week from now without it: which file, PR, or error.
`<repo>` is the current repository's directory name. One line, no sub-bullets.

Don't commit, don't touch anything else in mydesk, and don't act on the note;
the morning grooming triages the inbox. Reply with the line you wrote and
nothing more. The operator usually rewinds this exchange afterwards.
