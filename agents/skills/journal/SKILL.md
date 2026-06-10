---
name: journal
description: "Use when a judgment forms during work that a future session would benefit from — a fork you resolved, a correction from the user, a wrong assumption about the environment, something you had to rediscover. Appends one timestamped entry to the journal staging dir."
user-invocable: false
---

# Journal

Generic coding agents have no memory across sessions. The journal is how
the signal from one session survives into the next: a future
consolidation pass reads these entries and promotes the durable ones into
shared agent knowledge (global AGENTS.md, skills). You are the field
reporter; you don't curate, you capture.

## When to call

Prefer calling at the **moment a judgment forms**, not as session wrap-up.
If you get nudged to journal and can report about the judgement after the fact,
that's still better than nothing.
Under-capture is the bigger risk than over-capture.

Highest-signal categories (these are what the consolidation pass mines):

- **A correction from the user.** They pushed back on a plan or result and you
  revised. These are close to free training signal for the global config —
  capture the before, the correction, and what you'd do differently.
- **A wrong expectation about the environment.** A build quirk, a repo
  convention, a tool that behaved differently than you assumed. The next
  agent shouldn't have to rediscover it.
- **Something you had to rediscover** that a note would have saved.
- **A fork you resolved** where multiple plausible directions existed and
  you committed to one — record why the others lost.

Don't journal: routine task completion, things already written in
AGENTS.md / a skill / the project's CLAUDE.md, or one-off facts specific
to the current task with no carry-over value.

## How to call

From this skill's directory, run `scripts/journal` (use the absolute path —
the harness exposes this SKILL.md's location at load time):

```
scripts/journal decision "Chose X because ..." \
    --alternative "Y: why it lost" \
    --alternative "Z: why it lost"

scripts/journal observation "the thing worth preserving" --tags pi,bedrock
```

- **decision** — a judgment with a road not taken. Put the choice in prose;
  add one `--alternative` per rejected option, each with *why it wasn't
  chosen* (that's what makes the record useful on re-read). The flag is
  repeatable; one alternative per flag avoids comma-escaping headaches.
- **observation** — everything else worth keeping. Corrections, environment
  quirks, rediscoveries. `--tags` is optional, freeform, comma-separated.

One entry per call. If several distinct things qualify, pick the single
most durable rather than batching — the consolidation pass weighs entries
individually.

## Where entries go

Each call writes one timestamped markdown file (never edits an existing
one — that keeps concurrent agents on different machines merge-conflict
free when the store is synced). Destination resolves in order:

1. `--dir <path>` — explicit override.
2. `$AGENT_JOURNAL_DIR` — set on machines that opt the journal into a
   synced memory inbox.
3. `~/agent-journal-staging/` — the default local buffer, created on first
   write.

The default is a plain local directory, never a synced repo. This is a
safety property, not an accident: on a work machine, raw entries must not
flow to a personal remote before a scrub step exists, so the unconfigured
default stages locally. Don't add push/sync logic to this skill — routing
sanitized entries onward is the consolidation pass's job, downstream of
here.

You don't need to think about any of this at call time. Just journal; the
path is handled.

## Frontmatter

The script stamps each entry with `timestamp`, `type`, `harness`, `cwd`,
and — when available — `repo`, `session`, and `tags`. `repo` is the signal
the consolidation pass uses to tell work findings from personal ones, so
journal from inside the relevant repo when you can (the script reads cwd
automatically).
