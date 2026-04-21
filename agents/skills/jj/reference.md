# jj Advanced Reference

For flags and syntax details, run `jj <subcommand> --help`.

## Rewriting History — Agent Pitfalls

Most rewriting commands work as documented in `jj --help`. These are the
exceptions that need special handling:

- **`jj squash`** — always pass `-m "msg"` or `--use-destination-message`.
  Bare `jj squash` opens an interactive editor and hangs.
- **`jj split`** — interactive, will hang. See below.

## Splitting Commits (Agent-Friendly)

`jj split` is interactive and will hang. Use one of these approaches instead.

### Duplicate-and-trim (default — best when extracting a large portion)

Start with a full copy of the commit and remove what you don't want in the
first half:

1. **Duplicate as a sibling:**
   `jj duplicate <rev> --onto <rev>-`
   Note the new change ID from the output.
2. **Edit the duplicate and remove changes that belong in the second half:**
   `jj edit <new-change-id>`
   Use `jj restore --from <rev>- <paths...>` for whole files, or edit
   individual files for line/hunk granularity.
3. **Rebase the original (and its descendants) onto the trimmed duplicate:**
   `jj rebase -s <rev> -d <new-change-id>`
   jj deduplicates automatically — the rebased commit's diff will contain
   only the changes *not* in the duplicate.
4. **Describe both commits:**
   `jj describe -m "first half" -r <new-change-id>`
   `jj describe -m "second half" -r <rev>`

### Build-up (best when extracting a small piece)

Start empty and pull in only what you want in the first half:

1. `jj new <rev>-` — create an empty change before the commit to split.
2. `jj restore --from <rev> <paths...>` — pull in whole files, or edit files
   manually for line granularity.
3. `jj rebase -s <rev> -d @` — rebase the original onto the new commit;
   jj deduplicates the moved changes out of it.
4. Describe both commits.

## Revset Expressions

| Expression | Meaning |
|---|---|
| `@` | Working copy |
| `@-` | Parent of working copy |
| `<rev>+` | Children of a revision |
| `<rev>-` | Parent of a revision |
| `<a>::<b>` | Revisions from `a` to `b` (inclusive DAG range) |
| `<a>..<b>` | Revisions in `b` not in `a` |
| `heads(<revset>)` | Heads (tips) of a set |
| `trunk()` | The trunk/main bookmark |
| `mine()` | Changes authored by you |
| `description(pattern)` | Changes matching description pattern |
| `empty()` | Empty changes |
