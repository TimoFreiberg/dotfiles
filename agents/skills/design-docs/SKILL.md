---
name: design-docs
description: "Use before substantial investigation or implementation in a repository that has design docs: locate and read the design doc for the current task from the private Confluence collection."
---

# Design Docs

Design docs record agreed intent and constraints. The codebase is the source of
truth for current implementation; surface differences as findings rather than
treating them as permission to change intent or scope.

## Resolve the collection

The collection lives in Confluence, reached through the Atlassian MCP tools.
Environment variables locate it:

- `DESIGN_DOCS_CONFLUENCE_CLOUD_ID` — the site to pass as `cloudId`
- `DESIGN_DOCS_CONFLUENCE_SPACE_KEY` — the space to scope searches to
- `DESIGN_DOCS_CONFLUENCE_PARENT_ID` — the collection page whose children are the design docs
- `DESIGN_DOCS_CONFLUENCE_PARENT_URL` — readable location to cite in reports

Require the cloud ID, space key, and parent ID to be non-empty. Diagnose `unset`
or `empty` and stop rather than guessing a site, space, or page. Never substitute
a different collection or a local file. When the Atlassian tools are unavailable,
report that plainly instead of proceeding as though no doc exists.

## Find the relevant doc

An operator-supplied page takes precedence; still confirm its scope matches the
current task and surface contradictions. Otherwise search the space for a ticket
ID, and list the children of the collection page to enumerate candidates.

1. Prefer an exact ticket match. Inspect the current change, relevant bookmarks
   or branches, and nearby unmerged commit descriptions for ticket IDs. Follow
   the current work's ancestry and stop at shared history; do not search
   unrelated bookmarks. Operator-supplied tickets outrank inferred ones.
2. Without a ticket match, compare page titles against the branch or bookmark
   name and relevant commit titles, ignoring case and normal space, hyphen, and
   underscore differences. Surrounding branch prefixes or commit wording are fine
   when the whole descriptive phrase is clearly present.
3. Partial keyword or topic similarity alone is not a match. Ask when several
   pages are plausible, when a short generic title's relevance is unclear, or
   when ticket evidence conflicts. No matching ticket is different from
   contradictory ticket metadata; a ticketless page is allowed, a conflicting
   ticket must be surfaced.

One feature may span repositories, so confirm the candidate fits this repository
as well as this task. Name the selected page and why it applies, then read it
before substantial work. If nothing matches, do not manufacture a match: only
when starting substantive work, propose creating a doc and wait for
authorization. Routine fixes need no document.

## Treat pages as read-only

Every change, including factual corrections, status notes, and wording, requires
explicit operator authorization. Propose the concrete change before writing, and
reread the current page immediately before editing so intervening human changes
survive.

Implementation subagents never edit design docs. Pass the selected page URL and
the read-only constraint to any subagent that needs the context; subagents return
findings or proposed updates. Pause work that depends on an unresolved
consequential decision; independent agreed work may continue. When the session
cannot ask, report and block the dependent work rather than editing by inference.

After an authorized change, name the page and summarize the update in the final
response, and distinguish proposed changes from applied ones.
