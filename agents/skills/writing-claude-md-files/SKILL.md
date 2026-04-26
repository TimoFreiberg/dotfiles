---
name: writing-claude-md-files
description: "Use when creating or updating CLAUDE.md / AGENTS.md files for a project or a subdirectory. Covers the split between top-level (how to work here) and domain-level (why this exists, what it promises), and the freshness date convention."
user-invocable: false
---

# Writing CLAUDE.md / AGENTS.md Files

These files exist because agents start each session without context. They
preserve the things you'd otherwise re-explain every time: how to build,
what the conventions are, why a domain is shaped the way it is.

For directive-writing fundamentals (token economy, motivation framing,
discovery), see [writing-claude-directives](../writing-claude-directives/SKILL.md).

`CLAUDE.md` and `AGENTS.md` are interchangeable for most tooling. Pick one
per repo and stick with it; many projects symlink them so both work.

## Top-level vs. subdirectory

The two flavors do different jobs:

- **Top-level (repo root):** *How to work in this codebase.* Tech stack,
  build commands, project structure, conventions, edit boundaries. The
  "new engineer on day one" content.
- **Subdirectory (domain or subdomain):** *Why this piece exists and what
  it promises.* Purpose, contracts, invariants, gotchas. The "you're
  about to touch this — read this first" content.

Hierarchy: agents read CLAUDE.md from the file's directory up to the repo
root. So a file in `src/domains/auth/` gets `src/domains/auth/CLAUDE.md`
plus the root one — no need to repeat root content in domain files.

Depth heuristic: typically zero or one level of subdirectory CLAUDE.md
files. Two levels (e.g. `auth/oauth2/CLAUDE.md`) is rare and only when the
subdomain has its own non-obvious contracts.

## Top-level template

```markdown
# [Project Name]

Last verified: 2025-12-17

## Tech Stack
- Language: TypeScript 5.x
- Framework: Next.js 14
- Database: PostgreSQL
- Testing: Vitest

## Commands
- `npm run dev` — start dev server
- `npm run test` — run tests
- `npm run build` — production build

## Project Structure
- `src/domains/` — domain modules (auth, billing, etc.)
- `src/shared/` — cross-cutting utilities
- `src/infrastructure/` — external adapters (DB, APIs)

## Conventions
- Functional core, imperative shell
- Domains are self-contained — no cross-domain imports
- Domain-specific guidance lives in each domain's CLAUDE.md

## Boundaries
- Safe to edit: `src/`
- Don't touch: `migrations/` (immutable history), `*.lock`
```

What to leave out of the top-level file:

- Style rules linters already enforce.
- Exhaustive command listings (point at `package.json` / `justfile` instead).
- Domain-specific content (push it down into the domain file).
- Secrets, credentials, or anything sensitive.

## Subdirectory template

```markdown
# [Domain Name]

Last verified: 2025-12-17

## Purpose
[1-2 sentences: why this domain exists, what problem it owns.]

## Contracts
- **Exposes:** [public interface — what callers can use]
- **Guarantees:** [promises this domain keeps]
- **Expects:** [what callers must provide]

## Dependencies
- **Uses:** [domains/services this depends on]
- **Used by:** [what depends on this]
- **Boundary:** [what should NOT be imported here]

## Key Decisions
- [Decision]: [Rationale]

## Invariants
- [Things that must always be true]

## Key Files
- `index.ts` — public exports
- `service.ts` — main implementation

## Gotchas
- [Non-obvious thing that will bite you]
```

Worked example — auth domain:

```markdown
# Auth Domain

Last verified: 2025-12-17

## Purpose
Verifies user identity once at the system edge. Downstream services trust
the token without re-validating.

## Contracts
- **Exposes:** `validateToken(token) → User | null`, `createSession(creds) → Token`
- **Guarantees:** Tokens expire after 24h. User objects always include roles.
- **Expects:** Valid JWT format. Database connection available.

## Dependencies
- **Uses:** Database (users), Redis (session cache)
- **Used by:** All API routes, billing (user identity only)
- **Boundary:** Don't import from billing, notifications, or other domains

## Key Decisions
- JWT over session cookies — stateless auth for horizontal scaling
- bcrypt cost 12 — legacy; argon2 migration tracked in ADR-007

## Invariants
- Every user has exactly one primary email
- Deleted users are soft-deleted (is_deleted), never hard deleted
- User IDs are UUIDs, never sequential

## Key Files
- `service.ts` — AuthService implementation
- `tokens.ts` — JWT creation/validation
- `types.ts` — User, Token, Session

## Gotchas
- `validateToken` returns null on invalid input, doesn't throw
- Never include raw password hashes in serialized User objects
```

## Freshness dates

Every CLAUDE.md should have a `Last verified` date near the top. The date
signals when the contracts were last confirmed against the code; without
it, a six-month-old file looks identical to one written yesterday.

Get the actual date from the shell rather than guessing:

```bash
date +%Y-%m-%d
```

Stale CLAUDE.md is worse than missing CLAUDE.md — it's wrong with
confidence. When you touch a domain whose contracts changed, update the
date in the same change.

## When to add a subdirectory file

Add one when the domain has:

- Non-obvious contracts other parts of the system depend on.
- Architectural decisions that should constrain future edits.
- Invariants that aren't readable from the code alone.
- A pattern of new sessions needing the same context re-explained.

Skip it for:

- Trivial utility folders.
- Implementation details that change frequently (the file goes stale fast).
- Content that's better as a code comment next to the relevant function.

## Updating

When you change a domain that has a CLAUDE.md:

1. Update `Last verified` to today.
2. Re-check the contracts — are they still accurate?
3. Cut anything that's no longer true. Short-and-correct beats long-and-wrong.
4. Keep it under ~100 lines for a subdirectory file, ~300 for top-level.

## Referencing files

Plain prose is enough — name the files inline:

```markdown
## Key Files
- `index.ts` — public exports
- `service.ts` — main implementation
```

Avoid `@./service.ts` syntax. That force-loads files into context whether
or not the agent needs them; just naming the file lets the agent read it
on demand.

## Common mistakes

| Mistake                                    | Fix                                                |
|--------------------------------------------|----------------------------------------------------|
| Describing what code does                  | Focus on why it exists and what it promises       |
| Missing or guessed freshness date          | Use `date +%Y-%m-%d` from the shell                |
| `@`-syntax file references                 | Just name the files; let the agent read on demand |
| Subdirectory file > 100 lines              | Push detail into code comments or split the file  |
| Repeating top-level content in subdirs     | Subdirectories inherit; don't duplicate            |
| Docs unchanged after the domain changed    | Update `Last verified` and check the contracts     |

## Quick checks before committing

Top-level:
- Tech stack, commands, structure listed
- Freshness date present and accurate

Subdirectory:
- Purpose answers *why*, not *what*
- Contracts: exposes / guarantees / expects all filled in
- Dependencies and boundaries clear
- Invariants listed where they're non-obvious
- Freshness date present and under ~100 lines
