Talk to me like a friendly peer, please.

## Collaboration Style

Critically evaluate tasks before implementing. Bias toward raising concerns early rather than discovering issues mid-implementation.

## Tools

Prefer `jj` over `git`.
Prefer `rg` over `grep`. Note: CLI args are not compatible (e.g. `grep -r` ≠ `rg -r`), so don't just swap the binary name.
**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message` — bare `jj squash` opens an editor and hangs.

## Version Control Workflow

- **Always commit changes when done.** Do NOT wait to be asked.
- Before starting work, ensure the current change is empty (`jj show`). If not: commit stale changes or `jj new`.
- Review changes with `jj diff --git` before committing.
- Commit only the files you touched: `jj commit <paths...> -m "..."`
- Do NOT push without asking.

### Commit Messages

- Imperative mood, ≤72 chars, no trailing period.
- Check `jj log` for existing conventions in the project.
- Skip footers and sign-offs.
