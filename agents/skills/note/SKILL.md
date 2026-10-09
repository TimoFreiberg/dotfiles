---
name: note
description: "Use when the operator says `note: …` or asks to jot something down for later: capture it into the configured TODO inbox and get back to work."
---

Read `${XDG_CONFIG_HOME:-$HOME/.config}/note/inbox`: one absolute path,
allowing a leading `$HOME/` or `~/`. Expand only that prefix; never evaluate
the path as shell code. If the config is missing or invalid, or the inbox
file is missing, ask for an existing inbox's path and save it with file tools.

Append to the end of `# Inbox` (create the section if missing):

    - [ ] <the operator's words>  ·<repo> ·<MM-DD>

Keep the wording; add context only if it would be unreadable a week later
without the file, PR, or error. `<repo>` is the current repository's directory
name. One line, no sub-bullets.

Don't commit, touch neighboring files, or act on the note; morning grooming
triages the inbox. Reply only with the line written. The operator usually
rewinds this exchange afterwards.
