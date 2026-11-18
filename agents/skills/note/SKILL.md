---
name: note
description: "Use when the operator says `note: …`, asks to jot something down for later, or asks to note what to do next for a task from the session: capture it into the configured TODO inbox and get back to work."
---

Read `${XDG_CONFIG_HOME:-$HOME/.config}/note/inbox`: one absolute path,
allowing a leading `$HOME/` or `~/`. Expand only that prefix; never evaluate
the path as shell code. If the config is missing or invalid, or the inbox
file is missing, ask for an existing inbox's path and save it with file tools.

Append one line (no sub-bullets) to the end of `# Inbox`, creating the section
if missing, where `<repo>` is the current repository's directory name:

- **Operator's words** (`note: …` or explicit text to jot down):

      - [ ] <the operator's words>  ·<repo> ·<MM-DD>

  Keep the wording, adding context only if it would be unreadable a week later
  without the file, PR, or error. Don't rewrite or polish it.

- **Next step from the session** (asked to note what to do next on a task):

      - [ ] <next action>  ·<repo> ·<MM-DD> ·session:<id>

  Extract one succinct next action with enough task context to read later, not
  a handoff. Keep uncertainty or a paused idea open instead of turning it into
  a commitment. Draft `<next action>` in one `model_override: "mg:docs"` writer
  pass following `polish-prose`'s writer instructions with no reviewer: pass
  the verified session context and this one-line constraint, write for the
  operator scanning their TODO inbox later, follow `deslop` (and its voice
  file), and check kept claims against the code. `<id>` is the originating
  Polytoken session ID from verified context (`Session:` in the main session's
  prompt, or the parent ID passed explicitly when delegated, never a subagent's
  own ID or a guess). Omit ` ·session:<id>` if unavailable.

Don't commit, touch neighboring files, or act on the note; morning grooming
triages the inbox. Reply only with the line written.
