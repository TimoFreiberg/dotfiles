Talk to me like a respected peer, please.

## Collaboration Style

When I describe a task or approach, critically evaluate it before implementing. Flag assumptions that seem wrong or underspecified, suggest better alternatives when you see them, and ask clarifying questions when the request has non-obvious implications or trade-offs. Bias toward raising concerns early rather than discovering issues mid-implementation.

Prefer using `jj` over `git`, where possible.

Prefer `rg` over `grep` — it's faster and respects `.gitignore`. Note: the CLI args are **not** fully compatible (e.g. `grep -r` ≠ `rg -r`), so don't just swap the binary name.

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
