# Agent Guidelines

## Shell

Shell commands run in the project root. Do not prefix with `cd`.

## Code Navigation

Prefer the `lsp` tool over `grep`/`find`/`rg` for code intelligence tasks:
- **Finding definitions**: use `lsp definition` instead of grepping for function/class names
- **Finding usages**: use `lsp references` instead of grepping for identifiers
- **Understanding types/signatures**: use `lsp hover` instead of reading surrounding code
- **Browsing file structure**: use `lsp symbols` instead of grepping for `def`/`class`/`fn`

Fall back to `grep`/`rg`/`find` only when LSP is unavailable, returns no results, or the search is for plain text (log messages, comments, config values).

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
1. Review changes with `jj diff --git`
2. Check `jj log` for existing scope conventions
3. Do NOT push without asking

Skip footers and sign-offs.
