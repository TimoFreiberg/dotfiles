---
name: daily-grooming
description: "Use when starting your work day: groom the todo list to a trusted state, archive finished work, surface today's candidates, and propose a concrete first move. Stab-then-confirm, ~5 min."
---

# Daily Grooming

A morning pass that gets the user's todo list to a trusted state, pre-loads the
day's context, and proposes a concrete first move. You do the gathering and
propose; the user confirms or corrects. Optimizes for two things: the list is
fresh enough that the user treats it as the source of truth during
context-switch moments, and the first action is obvious enough to start without
deliberating.

## Why this exists

The diagnosis behind this is **task-residue exposure during dead time.** During
transition moments — a mini-break, waiting on an agent, hunting for a tab —
leftover tabs and threads from other tasks are visible. The eye lands on one and
the context-switch is automatic, barely a conscious choice. A todo list exists,
but sporadic maintenance keeps it below the trust threshold ("I can't follow it
right now"), so the gut-reaction switch wins and context-switch debt piles up
unnoticed until end of day.

This skill targets the *trust threshold*, not the planning step. Maintenance is
the unlock; planning is a side effect.

**The same trap applies inside this skill.** Waiting on the user to generate
from scratch is the same dead-time as waiting on a tab — the user drifts during
it. So minimize the user's generate turns. Front-load proposals; each user turn
should be a confirm-or-correct, not a generate. See "Session shape."

Two things make agent-led grooming worth more than self-discipline:

1. **External accountability.** A proposal landing from outside produces a
   different commit than self-asking.
2. **Pre-loaded state.** You open with yesterday's git/PR/journal already
   loaded; the user's morning brain doesn't. This is also what makes the stab
   possible — without state-loading you have nothing to propose and fall back to
   open-ended questioning, which is the failure mode.

## Pre-session: load state

Before the first message, gather in parallel where possible (budget ~60s; if
something's slow, skip it and say so in the session):

1. **Yesterday's git/PR activity.** Commits, PRs opened / merged / reviewed,
   what shipped.
2. **Yesterday's journal entries** (if any) — reasoning, calibrations, things
   flagged.
3. **Current todo state.** What's there, what's marked done, what's stale
   (default: untouched >3 days with no status change).
4. **PRs in the user's court.** Anything aged that needs surfacing.

## Session shape

**Stab-first, confirm-driven.** Front-load proposals so each user turn is a
confirm-or-correct, not a generate. Two user turns is the ceiling; often one is
enough.

Worked example:

```
you:  Morning. Yesterday: shipped <X>, merged <Y>. <Z> is still in
      <reviewer>'s court (3 days). 3 items from Monday still open: <list>.

      Done since last groom — moving to the weeklog: <a>, <b>.
      <a> looks win-worthy (<goal>); want a wins/ entry?

      My read of today:
      - Primary: <stab>
      - Secondary: <stab>, <stab>
      - Watching: <stab — no action needed>

      First move, unless you've got a different pull: <one concrete
      action> — <one-line why>.

      Anything wrong? Otherwise I commit it as-is.

user: <single message: corrections, or "looks good">

you:  Done. Todo updated, <done items> moved to the weeklog,
      <win logged / skipped per answer>.
```

Three steps:

1. **State + proposal in one message.** Brief state summary, the done items
   you're about to archive, your stab at today, and one concrete first move.
   Front-loaded, scannable.
2. **Single user turn.** Confirm or correct, in any shape.
3. **Commit.** Write the todo, archive done items, create any win entry the user
   okayed.

## Generating the stab

The stab matters more than the question. With state loaded you have enough to
propose:

- **Primary** = highest-priority unfinished thread from yesterday + anything
  aged in the user's court.
- **Secondary** = next-most-pressing, max 2–3.
- **Watching** = passive items you'll track but the user doesn't drive today
  (e.g. "PR #X waiting on review, no action needed").

If state-loading genuinely yields no stab (vacation return, true blank slate),
say so: "I don't have a strong read today — what's first?" That's the only
legitimate single-question turn. Otherwise: stab.

### Proposing the first move

The primary thread is *what matters most*; the first move is *what to physically
start*. They aren't always the same, and the gap is where cold-start drift
happens — so name one concrete, bounded first action (not a whole thread) the
user can begin without deliberating. Bias toward:

- **Momentum:** something small and concrete (a specific review, a bounded task)
  that gets the user moving, over a large amorphous thread.
- **Leverage / time-sensitivity:** if something is clearly highest-leverage or
  unblocking someone else, lead with that instead.

Give one line of why, and always leave it overridable: "unless you've got a
different pull." The point is to break the blank-page moment, not to dictate.

## Archiving done work

When the user marks something done (or confirms a done item you surfaced):

1. **Log it to the weeklog.** Every done item — err toward over-logging; the
   weeklog is the durable record. Match the repo's existing format.
2. **Remove it from the todo.** The weeklog is the record of completed work;
   don't leave done items lingering. A checked-off `[x]` that never gets removed
   is exactly how the list drifts below the trust threshold. If the item had a
   backing detail file (some setups give nontrivial items their own file), close
   or remove that too — a dangling task file is the same drift one tier down.
3. **Flag win-worthy items.** Accomplishment-level work (shipped a project,
   drove a decision, cross-team impact) is a candidate for a dedicated
   wins/accomplishments entry. Propose it; don't auto-create for routine work.

## Tone

- **Relaxed, conversational.** Not a standup template. The bar is "~5 min, not a
  slog."
- **Short.** If it's running to 10 min, the design is wrong.
- **Skip rather than push.** If a step has nothing for it that morning (nothing
  shipped yesterday, no done items to archive), skip it. Don't perform the
  ritual for its own sake — and if the morning stops feeling worth it, say so
  rather than going through the motions.
- **Proposal, not interrogation.** Stab → confirm beats ask → wait. Open-ended
  questions when state-loading would have produced a stab recreate the exact
  dead-time this skill is solving for.

## Adapting to your setup

This skill is layout-agnostic. Where the files live and how done work is archived
come from the repo you run it in — check its `AGENTS.md` / `CLAUDE.md` for the
work-tracking conventions before the first run:

- **Where the todo list lives** and its section structure.
- **Where done work goes** (a weeklog, a done-archive) and whether items are
  deleted or checked off — follow the repo's rule.
- **Whether nontrivial items get their own backing file** (a `tasks/` dir or
  similar). If so, surfacing such an item means reading its file for context,
  and archiving it means updating or removing that file too — not just the list
  line.
- **Where accomplishments go** (a wins/ dir, a brag doc) and any required
  frontmatter.
- **What counts as stale** (default: >3 days untouched).
- **Invocation.** This is user-invoked; a slash command (`/daily-grooming`) is
  the natural trigger, since it puts initiative on the user so skipped days need
  no explicit "skip."

If the repo doesn't document these, ask once and suggest recording the answers
in its `AGENTS.md` so the next run is parameter-free.
