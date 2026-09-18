---
name: writing-design-docs
description: "Use when explicitly asked for a PRD or technical design, or when designing consequential, cross-component, compatibility-sensitive, or unfamiliar feature work — maintains a private canonical working design and prepares reviewable, one-way publication prose."
---

# Writing Design Docs

## Choose the destination

Treat an explicit destination as supplied even when its value is empty. A supplied destination wins only when it names a readable, writable page in the design-doc collection, or a new child page under it. An empty value, or a page outside the collection, is an error: prompt instead of consulting the collection coordinates or falling back to the current repository.

When no explicit destination was supplied, resolve the collection as [design-docs](../design-docs/SKILL.md) describes and require its coordinates to be non-empty; diagnose only `unset` or `empty` unless the operator needs the resolved location. Create the document as a direct child of the collection page, titling it with the ticket ID when one exists followed by a concise descriptive phrase. Update an unambiguous existing page for the same feature, and prompt rather than overwrite or choose among collisions.

## Keep one canonical design

While design is active, the private design doc is authoritative. Shape its curated core around the problem and outcome, constraints and non-goals, design and rationale (including meaningful rejected alternatives), and delivery and verification. State observable acceptance criteria and significant invariants, and map each to a named test, benchmark, fault scenario, or other concrete check. Choose one exact term for each domain concept and reuse it; use another term only when a verified difference in referent, state, or role requires it. Define terms when readers would not know them or could confuse related concepts, but do not require a glossary when the prose is already clear. Add product or technical concerns only when they affect a decision, omit empty headings, and reserve open questions for decisions reviewers must make. Scale this core to the actual decision surface rather than imposing heavyweight sections.

## Work from evidence

Use a temporary working-notes section in the document itself as an evidence inbox during exploration: keep compact source references, label hypotheses, and separate candidate decisions and open questions from verified facts. Curate the main body for a human reviewer to skim and understand the proposed change; keep detailed provenance in working notes rather than turning the design into an audit trail. Periodically promote supported material into the design, reconcile contradictions, and delete stale sediment. Never present an unverified claim as fact or silently invent a consequential choice; preserve the responsible decision-maker's authority.

## Curate before and after change

Do not call the design settled or review-ready while load-bearing claims remain unverified, consequential decisions remain ownerless, or raw notes have not been promoted, reconciled, or removed. Before review, apply [editing-documentation](../editing-documentation/SKILL.md) to make the document accurate and concise. After material implementation or review changes, reconcile the canonical design again so it describes the decision that actually ships.

## Publish by distillation

At completion, manually prepare output-only publication prose from the curated design. Exclude raw notes, unpromoted hypotheses, and synchronization metadata; prepare text without performing or proposing mutation of public text such as pull-request descriptions or tickets. Separately identify any enduring repository documentation the delivered system needs, and write that as a durable distillation rather than treating the private design doc or ticket text as synchronized copies.
