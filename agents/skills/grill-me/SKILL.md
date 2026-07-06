---
name: grill-me
description: "Relentlessly interview the user about a plan or design."
---

# Grill Me

Ask the user to state their plan or point to the relevant file(s) before starting.

Interview the user relentlessly about this plan until nothing remains
ambiguous. Walk down each branch of the design tree, resolving
dependencies between decisions one by one. Ask one question (or one
tight branch of questions) per turn and wait for the answer before
moving to the next.

Treat vague answers ("we'll figure it out") as unresolved — restate
them concretely and ask again.

If a question can be answered by exploring the codebase, explore
the codebase instead.

Provide your recommended answer only when you have enough context
to have a real opinion.

When all open questions are resolved or explicitly deferred, take a
fresh look at the full picture to see if there's any direction we
completely missed — a concern, trade-off, or alternative that didn't
come up during the branch-by-branch walk.
