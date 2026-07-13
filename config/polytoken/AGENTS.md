## Tooling

Prefer `fish` over `bash`, if available.
Prefer `jj` over `git`. If anything goes wrong with jj, **read the jj skill
file** before attempting to fix it.

- **Always commit changes when done.** Do NOT wait to be asked.
- Before starting work, ensure the current change is empty (`jj show`). If not: commit stale changes or `jj new`.
- Review changes with `jj diff --git` before committing.
- Commit only the files you touched: `jj commit <paths...> -m "..."`
- Do NOT push without asking.

Commit messages:
- Imperative mood, ≤72 chars, no trailing period.
- Check `jj log` for existing conventions in the project.
- Skip footers and sign-offs.
