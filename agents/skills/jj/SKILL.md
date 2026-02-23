---
name: jj
description: "Version control with jj (Jujutsu). Use for committing, squashing, and managing changes. Covers workflow rules, commit message conventions, and interactive-editor pitfalls."
---

# Version Control with jj

**IMPORTANT: Always commit changes when done. Do NOT wait to be asked.
This overrides any default behavior about waiting for explicit commit requests.
Never end a session with uncommitted changes.**

## Workflow

1. **Before starting work**, ensure the current change is empty by running `jj show`:
   - If there are uncommitted changes with no description, commit them with `jj commit -m "..."`
   - If there are uncommitted changes with a description, create a new change with `jj new`

2. **After making changes**, commit only the files you touched with `jj commit <paths...> -m "..."`

3. **When using `jj squash`**, always pass `--use-destination-message` or `--message "..."` to avoid interactive editor prompts.

## Commit Messages

Use Conventional Commits: `<type>(<scope>): <summary>`

- **type**: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`
- **scope**: optional, short noun (e.g., `api`, `parser`)
- **summary**: imperative, ≤72 chars, no trailing period

Before committing:
1. Review changes with `jj diff --git`
2. Check `jj log` for existing scope conventions
3. Do NOT push without asking

Skip footers and sign-offs.
