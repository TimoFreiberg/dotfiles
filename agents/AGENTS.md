# Agent Guidelines

## Version Control with jj

1. **Before starting work**, ensure the current change is empty by running `jj show`:
   - If there are uncommitted changes with no description, commit them with `jj commit -m "..."`
   - If there are uncommitted changes with a description, create a new change with `jj new`

2. **After making changes**, describe and commit with `jj commit -m "..."`

## Commit Messages

Use Conventional Commits: `<type>(<scope>): <summary>`

- **type**: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`
- **scope**: optional, short noun (e.g., `api`, `parser`)
- **summary**: imperative, ≤72 chars, no trailing period

Before committing:
1. Review changes with `jj diff --git` (the default `jj diff` uses inline word-level diffs that concatenate old+new text, making it hard to read)
2. Check `jj log` for existing scope conventions
3. Do NOT push without asking

Skip footers and sign-offs.
