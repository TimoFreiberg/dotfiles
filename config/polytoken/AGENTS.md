## Links

Whenever you mention a ticket, PR, issue, dashboard or other online resource in a reply, include its full URL (a markdown link is fine), not just the bare ID like `#1234` or `PROJ-56`.

## Version Control

Prefer `jj` over `git`.
If anything goes wrong with jj,
**read the jj skill file** before attempting to fix it.

- **Always commit changes when done.** Do NOT wait to be asked.
- Before starting work, ensure the current change is empty (`jj show`). If not: commit stale changes or `jj new`.
- Review changes with `jj diff --git` before committing.
- Commit only the files you touched: `jj commit <paths...> -m "..."`
- Do NOT push without asking.

### Commit Messages

- Subject: imperative mood, ≤72 chars, no trailing period.
- Prefix the subject with a ticket ID (e.g. `[PROJ-123]`) when context makes it obvious and unambiguous which ticket applies.
- Body (include unless trivial, like formatting or a simple rename): 1-2 short paragraphs of plain prose giving a bird's-eye view of *why* (problem, constraint, or context the diff doesn't show) and, only when non-obvious, the high-level *how*. No file lists, detailed change lists, or diff narration.
- Check `jj log` for existing conventions in the project.
- Skip footers and sign-offs.
