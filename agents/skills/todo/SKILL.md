---
name: todo
description: Manage TODO items tracked as markdown files in the repo's .todos/ directory. Use when the user wants to add, list, complete, edit, or delete project TODOs.
argument-hint: "[add <title> | list | done <query> | refine <query> | delete <query>]"
---

## Current state

- TODOs directory: !`test -d .todos && echo "exists ($(ls .todos/*.md 2>/dev/null | wc -l | tr -d ' ') items)" || echo "not created yet"`
- Open TODOs: !`ls .todos/*.md 2>/dev/null | while read f; do echo "- $(basename "$f" .md)"; done || echo "(none)"`

## Operations

Parse `$ARGUMENTS` and dispatch:

| Argument pattern | Action |
|---|---|
| *(empty)* | List all TODOs. If there are any, ask the user what they want to do next. If none, say so. |
| `add <title>` | Create a new TODO (see "Add" below) |
| `list` | List all TODOs with their created dates |
| `done <query>` | Mark a TODO as done by deleting its file (see "Match" below) |
| `refine <query>` | Discuss and improve a TODO interactively (see "Refine" below) |
| `delete <query>` | Alias for `done` — deletes the TODO file |
| Free-form text without a known verb | Treat as `add <text>` |

## Add

1. Create `.todos/` directory if it doesn't exist: `mkdir -p .todos`
2. Slugify the title: lowercase, replace spaces and special characters with hyphens, collapse consecutive hyphens, trim to 60 chars, strip leading/trailing hyphens
3. Write `.todos/<slug>.md` with this format:

```markdown
---
created: <today's date YYYY-MM-DD>
---
# <Original title>
```

4. If the user provided additional description beyond the title, add it as body text after the heading.
5. Confirm creation with the filename.

## List

1. Glob for `.todos/*.md`
2. For each file, read the first heading (`# ...`) and the `created` date from frontmatter
3. Display as a list sorted by creation date (oldest first):
   ```
   - fix-auth-edge-case (2026-02-18) — Fix the auth edge case
   - add-retry-logic (2026-02-20) — Add retry logic
   ```
4. If no files found, say there are no TODOs.

## Match (for done/refine/delete)

1. Glob for `.todos/*.md`
2. Match `<query>` against filenames (without extension) using substring/prefix matching
3. If exactly one match: proceed with the operation
4. If multiple matches: use AskUserQuestion to let the user pick
5. If no matches: tell the user and show available TODOs

## Done / Delete

1. Match the query to a file (see "Match")
2. Delete the file using Bash `rm`
3. Confirm deletion. Mention that version control preserves history if the directory is tracked.

## Refine

1. Match the query to a file (see "Match")
2. Read the file
3. Present the current TODO content to the user
4. Discuss the TODO with the user to improve it. Think critically about what's missing:
   - Is the problem or goal clearly defined?
   - Are there acceptance criteria or a definition of done?
   - Are there edge cases, constraints, or dependencies worth noting?
   - Is there relevant context (affected files, related TODOs, prior decisions)?
   - Could the TODO be split into smaller, more actionable items?
5. Use AskUserQuestion to ask clarifying questions — ask whatever would help make the TODO more concrete, actionable, and complete
6. After the discussion, update the TODO file with the refined content using the Edit tool
7. Show the user the final version
