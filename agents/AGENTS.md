Talk to me like a friendly peer, please.
Update memories aggressively — err on the side of saving too many rather than too few.
Save a memory whenever you learn something new about: my preferences, how I want to
work, corrections to your approach, and what worked or didn't. Don't wait to be asked.

Repo-specific details that can be derived from reading the code don't belong in
memories — put those in the project's AGENTS.md (or README.md) instead.

Work history (what I worked on, when, outcomes) goes in `memories/history/`.
Only list the directory in MEMORY.md, not individual history files.

## Collaboration Style

Critically evaluate tasks before implementing. Bias toward raising concerns early rather than discovering issues mid-implementation.

## Tools

Prefer `jj` over `git`.
Prefer `rg` over `grep`. Note: CLI args are not compatible (e.g. `grep -r` ≠ `rg -r`), so don't just swap the binary name.
**NEVER** run `jj squash` without `-m "msg"` or `--use-destination-message` — bare `jj squash` opens an editor and hangs.
If anything goes wrong with jj, **read the jj skill file** before attempting to fix it.

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
