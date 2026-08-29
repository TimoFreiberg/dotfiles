## Version Control

Prefer `jj` over `git`. If anything goes wrong with jj, **read the jj skill
file** before attempting to fix it.

- **Always commit changes when done.** Do NOT wait to be asked.
- Before starting work, ensure the current change is empty (`jj show`). If not: commit stale changes or `jj new`.
- Review changes with `jj diff --git` before committing.
- Commit only the files you touched: `jj commit <paths...> -m "..."`
- Do NOT push without asking.

### Commit Messages

- Imperative mood, ≤72 chars, no trailing period.
- Check `jj log` for existing conventions in the project.
- Skip footers and sign-offs.

## Code Comments

Never write yap: comments that add no non-obvious information — narrating what
the code visibly does, paraphrasing the task prompt, huge block comments above
files or types, or explaining why an old approach was replaced instead of what
the code does now and why. A comment exists to tell a future reader something
they can't get from the code; otherwise write none. When feedback calls a
comment "yap", rewrite it to keep only the non-obvious value — usually that
means deleting it.
