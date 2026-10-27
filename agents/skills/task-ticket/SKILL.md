---
name: task-ticket
description: "Use when `ticket-context` printed a Jira ticket, when planning or slicing a task bigger than a day or two, or when work makes a ticket's description stale."
---

The Jira ticket holds a task's design. The parent ticket (usually an epic)
carries outcome, scope, and architecture; its child tickets are the slices,
each about one reviewable PR. A design too long for a ticket goes on a
Confluence page linked from the ticket description.

`ticket-context` in this skill's directory is the only lookup. It scans
`trunk()..@` descriptions and bookmarks for Jira keys and prints each
ticket's description, parent, child tickets, and linked Confluence pages,
then the parent in full (exit 0). Without keys it prints `No ticket: …`
(exit 1); on failure it reports to stderr (exit 2). Pass keys to look up
others. Run it once; don't search Jira or Confluence by other means, and
read a linked page only when it lists one.

Code is the source of truth for implementation, the ticket for intent and
scope; surface mismatches rather than resolving them.

Before writing code for a task bigger than a day or two without child
tickets, stop and work out with the operator (see `grill-me`):

- the slices, each a reviewable PR that lands on its own, and
- what you don't yet know about the affected code; investigate that first.

Propose the slices as child tickets. Tickets are shared with colleagues:
create or edit them only when the operator asks. Make description edits
through a subagent with `model_override: "mg:docs"`, passing it the ticket,
the update, and the necessary context. At the final handoff, if the work
changed scope or design, propose the exact ticket update in your final
message.
