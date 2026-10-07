---
name: writing-agent-md-files
description: "Use when creating or updating AGENTS.md files for a project or a subdirectory: what belongs at the root versus in a domain, and keeping them current."
---

These files give every new session the context you'd otherwise re-explain.
Write only what an agent can't get from the code, linter config, or build
files, and keep them short: roughly 200 lines at the root, 100 in a
subdirectory.

The root file says how to work here: stack, main commands, layout,
conventions, and what not to edit. A subdirectory file says why that part
exists and what it promises: purpose, contracts, invariants, gotchas.
Subdirectory files load only once the agent works in that directory, so rules
every session needs belong at the root, and nothing from the root is repeated
below. Add a subdirectory file only when its domain has contracts or
invariants the code doesn't make obvious.

Put `Last verified: <today's date from date +%Y-%m-%d>` near the top, update
it whenever you recheck the file against the code, and cut anything no longer
true. Prefer honest vagueness to precise claims you haven't checked against a
primary source; later agents will cite them as fact. Name files instead of
`@`-including them, unless loading them every session is the point.
