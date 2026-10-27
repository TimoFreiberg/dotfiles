---
name: design-docs
description: "Use when `find-design-doc` printed a design doc URL, when asked for a PRD or technical design, or when session work makes a found doc stale."
---

Design docs exist only for tasks with a Jira ticket. `find-design-doc` (on
`PATH`) is the only lookup: it scans `trunk()..@` descriptions and bookmarks
for Jira keys and prints `KEY<TAB>TITLE<TAB>URL` per matching page (exit 0),
`No design doc: …` (exit 1), or an error (exit 2). Run it once; don't search
Confluence by other means. On "No design doc", carry on without one and don't
propose creating one. On an error, say so and continue.

Read the found page with the Atlassian tools before substantial work. Code is
the source of truth for implementation, the page for intent; surface
mismatches rather than resolving them.

Create a page only when the operator asks: a child of
`$DESIGN_DOCS_CONFLUENCE_PARENT_ID` (space `$DESIGN_DOCS_CONFLUENCE_SPACE_KEY`,
site `$DESIGN_DOCS_CONFLUENCE_CLOUD_ID`), titled `KEY: Short name` so the
script finds it, and make sure a commit description or bookmark carries the
key.

Make page edits through a subagent with `model_override: "mg:docs"`, passing it
the page, the update, and the necessary context.

The page starts with an open-items checklist: decisions owed, external
dependencies, and known gaps not visible from `jj log` or open PRs. Delete
items once resolved. Below it, a concise technical design: outcome, scope,
architecture, and only the constraints and rationale a reader needs.

At the final handoff, update the open-items checklist yourself. Edit the rest
only when the operator asks; if it's stale, propose the exact change in your
final message.
