---
name: note
description: "Use when the operator says `note: …` or asks to jot something down for later: capture it into the configured TODO inbox and get back to work."
---

Read the inbox path from `${XDG_CONFIG_HOME:-$HOME/.config}/note/inbox`.
This machine-local file contains one nonblank line: an absolute path or a
path beginning with `$HOME/` or `~/`. Resolve that leading home prefix;
treat the rest literally, never as shell code. Quote paths in shell commands.

If the config is missing or invalid, or the target isn't an existing file,
ask the operator for the inbox path and stop before writing. Never guess a
destination or silently create an inbox file. Once confirmed, save the path
in that config file using file tools, not shell evaluation.

To set up a machine, create the config file with the desired path, for example
`$HOME/mydesk/TODO.md`. Keep the config outside the shared dotfiles.

Append the note as one line at the end of the target's `# Inbox` section
(create the section at the end of the file if it's missing):

    - [ ] <the operator's words>  ·<repo> ·<MM-DD>

Keep the operator's wording. Add a few words of context only when the line
would be unreadable a week from now without it: which file, PR, or error.
`<repo>` is the current repository's directory name. One line, no sub-bullets.

Don't commit, touch other files alongside the inbox, or act on the note;
the morning grooming triages the inbox. Reply with the line you wrote and
nothing more. The operator usually rewinds this exchange afterwards.
