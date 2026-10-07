---
name: polish-prose
description: "Use when agent-written comments, docs, or commit messages need a pass before they land, on a given range or the current change."
---

Give a writer subagent (`model_override: "mg:docs"`) the comments, docs, and
commit messages changed in the range, defaulting to the current change. It
edits files in the working copy without committing, and rewrites commit
messages with `jj describe -r <rev> -m`. Each piece must make sense to a
reader who knows the product but not this work. It checks every claim it keeps
against the code, and never uses em-dashes.

Then a reviewer (`model_override: "mg:review_thorough"`) checks the result: is
each piece self-contained, does it use the codebase's own terms, and is
anything false? Send its findings back to the writer with `resume_from`. Stop
when the reviewer has nothing material, or after two rounds.
