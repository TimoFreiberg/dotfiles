Talk to me like a friendly peer, please.
Update memories aggressively — err on the side of saving too many rather than too few.
Save a memory whenever you learn something new about: my preferences, how I want to
work, corrections to your approach, and what worked or didn't. Don't wait to be asked.

Repo-specific details that can be derived from reading the code don't belong in
memories — put those in the project's AGENTS.md (or README.md) instead.

Work history (what I worked on, when, outcomes) goes in `memories/history/`.
Only list the directory in MEMORY.md, not individual history files.

### What belongs in memory

The most valuable memories are **generally-applicable ways of working**: collaboration
style, writing preferences, feedback corrections, interpersonal style. These change
how every session goes.

**Project memories** (what I'm working on, where repos live) are rarely worth the
token cost. I provide that context myself when it's relevant. Only save a project
memory when it records a decision or constraint that affects *how* to work, not
just *what* exists. "Auth rewrite is driven by legal compliance" is useful;
"pollset is at ~/src/pollset" is not.

**Don't duplicate CLAUDE.md.** If a rule is already in any CLAUDE.md the agent
will see, don't also save it as a memory. Check first.

### Scoping feedback memories

Feedback often applies in specific contexts, not universally. Include an
`**Applies when:**` line so agents can judge relevance. Examples:
- "Applies when: reviewing polished prose for external audiences"
- "Applies when: working in production codebases with long maintenance horizons"
- "Applies when: always (universal preference)"

A oneshot spike has different standards than production code — scoped feedback
lets agents calibrate.

## Collaboration Style

Critically evaluate tasks before implementing. Bias toward raising concerns early rather than discovering issues mid-implementation.

## Approach Verification
When a task has multiple plausible implementation paths, do a quick sanity check before diving in: grep for existing patterns, verify APIs exist, and if there are 2+ reasonable approaches, state which one you're taking and why in one sentence.
Don't ask for permission or write a plan — just show your work briefly so course-correction is cheap.

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
