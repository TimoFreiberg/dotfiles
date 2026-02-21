---
name: tdo
description: "Manage TODOs with the tdo CLI. Handles natural-language requests like 'create a todo for that' or 'mark that done'."
argument-hint: "[add <title> | list | done <query> | reopen <query> | edit <query> | delete <query> | assign <query> [name] | unassign <query> | refine <query>]"
---

## Operations

Parse `$ARGUMENTS` and dispatch:

| Argument pattern | Action |
|---|---|
| *(empty)* | Run `tdo list`. If there are any, ask the user what they want to do next. If none, say so. |
| `add <title>` | Create a new todo |
| `list` | Run `tdo list` (open only) or `tdo list --all` (include done) |
| `done <query>` | Mark a todo as done |
| `reopen <query>` | Reopen a done todo |
| `edit <query>` | Edit a todo's body |
| `delete <query>` | Delete a todo |
| `assign <query> [name]` | Assign a todo (optionally to a person) |
| `unassign <query>` | Remove assignment from a todo |
| `refine <query>` | Research and refine a todo through discussion |
| Free-form text without a known verb | Treat as `add <text>` |

## Add

Run `tdo add <title words>`. It prints the assigned 4-char hex ID to stdout. Confirm creation to the user.

Titles are immutable after creation. To change a title, delete and recreate.

If the user provided additional context beyond the title, follow up with `tdo edit <id> --body "details"`.

## Matching queries to IDs

If the query is a hex ID or prefix (e.g. `a3f9`, `a3`), use it directly. Otherwise, run `tdo list --all`, match by title substring, and disambiguate with AskUserQuestion if needed.

## Assign / Unassign

Match the query to an ID (see above), then run:

- `tdo assign <id>` (assign without a name)
- `tdo assign <id> <name>` (assign to a specific person)
- `tdo unassign <id>`

Confirm the result to the user.

## Done / Reopen / Edit / Delete

Match the query to an ID (see above), then run the command:

- `tdo done <id>`
- `tdo reopen <id>`
- `tdo edit <id> --body "new body content"` (`--body` required for non-interactive use)
- `tdo delete <id> --force` (`--force` required for non-interactive use)

Confirm the result to the user.

## Refine

1. Match the query to an ID (see "Matching queries to IDs")
2. Read the todo file from `.todo/`
3. **Research before asking.** Based on the TODO content, proactively gather context:
   - If files, functions, or modules are mentioned, read them
   - If related TODOs exist, read those too
   - If the TODO references a bug or behavior, look at the relevant code
   - Search the codebase for anything directly related to the TODO's subject
   Do NOT ask the user questions you could answer by reading code or files.
4. Present the current TODO content and a brief summary of what you found
5. Think critically about what's missing or unclear:
   - Is the problem or goal clearly defined?
   - Are there acceptance criteria or a definition of done?
   - Are there edge cases, constraints, or dependencies worth noting?
   - Is there relevant context (affected files, related TODOs, prior decisions)?
   - Could the TODO be split into smaller, more actionable items?
6. Use AskUserQuestion to ask clarifying questions — only things that require human judgment. Include your own suggestions where possible.
7. After the discussion, update the TODO body with refined content using `tdo edit <id> --body "..."`
8. Show the user the final version
