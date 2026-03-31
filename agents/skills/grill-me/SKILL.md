---
name: grill-me
description: "Relentlessly interview the user about a plan or design."
---

# Grill Me

Ask the user to state their plan or point to the relevant file(s) before starting.

<!-- "ambiguous" appears to highly increase interview thoroughness. -->
Interview me relentlessly about this plan until nothing remains
ambiguous. Walk down each branch of the design tree, resolving
dependencies between decisions one by one.

If a question can be answered by exploring the codebase, explore
the codebase instead.

Provide your recommended answer only when you have enough context
to have a real opinion.

When all open questions are resolved or explicitly deferred, take a
fresh look at the full picture to see if there's any direction we
completely missed — a concern, trade-off, or alternative that didn't
come up during the branch-by-branch walk.
