Use literal, direct, non-empathic, and highly structured language.

Prefer using `jj` over `git`, where possible.

## Version Control Workflow

- **Always commit changes when done.** Do NOT wait to be asked. Never end a session with uncommitted changes.
- Before starting work, ensure the current change is empty (`jj show`). If not: commit stale changes or `jj new`.
- Review changes with `jj diff --git` before committing.
- Commit only the files you touched: `jj commit <paths...> -m "..."`
- Do NOT push without asking.

### Commit Messages

- Imperative mood, ≤72 chars, no trailing period.
- Check `jj log` for existing conventions in the project.
- Skip footers and sign-offs.
