---
name: design-docs
description: "Use before substantial task work to find and read its Confluence design doc, and when session work makes that doc stale to trigger an update."
---

# Design Docs

One task page holds current task state and a concise technical design. Code is
the source of truth for implementation; agreed decisions govern intent. Surface
discrepancies rather than silently changing requirements to match code.

## Resolve the collection

The collection lives in Confluence, reached through the Atlassian MCP tools:

- `DESIGN_DOCS_CONFLUENCE_CLOUD_ID`: site to pass as `cloudId`.
- `DESIGN_DOCS_CONFLUENCE_SPACE_KEY`: space to scope searches to.
- `DESIGN_DOCS_CONFLUENCE_PARENT_ID`: collection page whose children are task docs.
- `DESIGN_DOCS_CONFLUENCE_PARENT_URL`: readable location to cite in reports.

Require the cloud ID, space key, and parent ID to be non-empty. Diagnose `unset`
or `empty` and stop rather than guessing a destination or using a local file.
Report unavailable Atlassian tools instead of treating failure as no matching doc.

## Find the relevant doc

An operator-supplied page takes precedence; confirm its scope matches the task
and repository. Otherwise search the space for a ticket ID and list the
collection's children:

1. Prefer an exact ticket match. Inspect the current change and its unmerged
   ancestry, including relevant bookmarks or branches; stop at shared history.
   Operator-supplied tickets outrank inferred ones.
2. Without a ticket match, compare titles with branch names and commit titles,
   ignoring case and space, hyphen, or underscore differences. Require the whole
   descriptive phrase (prefixes are fine), not partial topic similarity.
3. Ask about ambiguous matches or conflicting ticket metadata. A ticketless page
   can match; a page citing a different ticket requires clarification.

Confirm the candidate fits this task and repository, name it and why it applies,
then read it before substantial work.
Read linked history only when a current question needs it. If nothing matches,
propose creating a doc and wait for authorization; routine fixes need no doc.

## Keep it current

**Autonomous writes touch only the open-items checklist.** When session work
changes open items, update that checklist without asking, once, with the final
handoff, not mid-session. Questions posed to the operator while the main task is
ongoing stay off the page; open items raised in the final handoff go on it.
Honor explicit read-only requests.

**Never edit the technical design or notable changes on your own.** At the
final handoff, check them against the session's work and, if something is now
wrong, stale, or missing, propose a minimal diff in the final message: the
section, the exact old text, and the replacement. Prefer deletions and
corrections over additions; propose nothing when the design is still accurate.
Preserve the doc's level of detail: a concern it never covered stays out by
default. Propose adding one only if it is core to the architecture, something a
reader needs to understand how the task works, not an incidental implementation
choice.
Apply a proposal only when the operator asks (e.g. "please make the change"),
exactly as proposed or as they adjust it. An operator request to write or edit
the design authorizes that edit.

Use the editor workflow in [writing-design-docs](../writing-design-docs/SKILL.md).
Implementation subagents return findings and evidence, not page edits. The caller
designates one documentation editor, or edits directly if subagents are unavailable.

Documentation permission does not authorize design decisions. Record unapproved
assumptions and implementation/design mismatches as unresolved. Pause dependent
work and ask about consequential choices; continue independent agreed work.
If asking is unavailable, report and block the dependent work.

Report the updated page, a short summary, and any proposed design diff; on
failure, say the page is stale and what update is pending.
