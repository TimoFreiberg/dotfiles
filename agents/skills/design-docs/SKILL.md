---
name: design-docs
description: "Use before substantial task work to find and read its Confluence design doc, when asked for a PRD or technical design, and when session work makes the doc stale."
---

Each task has one Confluence page under the collection page
`$DESIGN_DOCS_CONFLUENCE_PARENT_ID` (space `$DESIGN_DOCS_CONFLUENCE_SPACE_KEY`,
site `$DESIGN_DOCS_CONFLUENCE_CLOUD_ID`). If these are unset or the Atlassian
tools fail, say so and stop.

Find the page: one the operator names; else a child matching the ticket ID
from the current change's unmerged commits or bookmarks; else one whose title
matches the branch or commit titles. Ask when ambiguous. If nothing matches
and the task isn't routine, propose creating one. Read it before substantial
work. Code is the source of truth for implementation, the page for intent;
surface mismatches rather than resolving them.

Make page edits through a subagent with `model_override: "mg:docs"`, passing it
the page, the update, and the necessary context.

The page starts with an open-items checklist: decisions owed, external
dependencies, and known gaps not visible from `jj log` or open PRs. Delete
items once resolved. Below it, a concise technical design: outcome, scope,
architecture, and only the constraints and rationale a reader needs.

At the final handoff, update the open-items checklist yourself. Edit the rest
only when the operator asks; if it's stale, propose the exact change in your
final message.
