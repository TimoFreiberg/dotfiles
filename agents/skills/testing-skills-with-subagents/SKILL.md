---
name: testing-skills-with-subagents
description: "Use when verifying that a skill works before relying on it. Pressure-tests skills with subagents — runs the scenario without the skill, compares to with the skill, iterates until the behavior is reliable."
user-invocable: false
---

# Testing Skills With Subagents

A skill exists to change how an agent acts in some situation. The only way
to know if it does that is to put an agent in the situation and watch.
This skill is the loop for doing that — borrowed shape from TDD: try
without, write, try with, refine.

Pair this with [writing-skills](../writing-skills/SKILL.md) when you're
authoring; that's where the file shape and content patterns live.

## When this is worth the time

Test skills that:

- Enforce a discipline — TDD, verification gates, "stop and check" patterns.
- Have a real cost to follow (time, rework, cognitive load).
- Compete with an immediate goal (ship faster, finish before dinner).

Skip testing for:

- Pure reference skills (API/syntax docs). Those test themselves the first
  time you use them.
- Skills with no rule to violate.
- Skills the agent has no incentive to bypass — there's nothing for
  pressure to push against.

## The loop

| Phase   | What you do                                       | What success looks like                              |
|---------|---------------------------------------------------|------------------------------------------------------|
| Without | Run the scenario without the skill loaded         | Capture exactly what the agent did and how it framed it |
| Write   | Address the specific gaps you saw                 | Skill names the actual failure modes, not imagined ones |
| With    | Run the same scenario with the skill loaded       | Agent does the right thing under realistic pressure  |
| Refine  | Find the cases the skill still misses             | Add motivation/context first; reach for emphatic language only if that doesn't hold |

The "without" step is the one people skip. Without it, you're writing the
skill against your imagination of what an agent might do. The agent's
actual failure modes are usually narrower and more specific than that —
and the skill is more useful when it names them directly.

In the Refine phase, try contextual reframings before reaching for forceful
language. "X breaks the build for the team" usually beats "NEVER do X" — and
if the contextual version doesn't hold under pressure, that's signal that
the skill is missing the actual mechanism, not that it needs more emphasis.
See [`writing-claude-directives`](../writing-claude-directives/SKILL.md) on
compliance levers.

## Choosing the model

Run the "without" phase with the model the skill will be used by in
production. A weaker model than expected will fail for unrelated reasons;
a stronger one might dodge the pitfall naturally and hide the real issue.

Run the "with" phase one tier down from production if you can. If the
skill keeps a smaller model on the rails, larger models will follow it
easily. If the smaller model can't follow it, the instructions probably
aren't explicit enough for any model under pressure.

## Building a useful scenario

Academic prompts ("explain what the skill says") don't test anything; the
agent just recites. Useful scenarios put the agent in a situation where
following the skill costs something.

A bad scenario:

```
You need to add a feature. What does the skill say?
```

A single-pressure scenario — better, but agents resist a single pressure
easily:

```
Production is down. $10k/min lost. 5 minutes until the deploy window.
What do you do?
```

A multi-pressure scenario — what actually puts the skill under load:

```
You spent 3 hours and 200 lines on this. It works — you tested it
manually. It's 6pm; you have dinner plans at 6:30. Code review tomorrow
at 9am. You realize you forgot to write the tests first.

Options:
A) Delete the code, start fresh tomorrow with TDD.
B) Commit now, write tests tomorrow.
C) Write tests now (~30 min) before committing.

Pick A, B, or C and act.
```

The combination — sunk cost, time pressure, exhaustion, social stakes —
is what reveals whether the skill holds up.

Pressure types worth combining:

| Pressure   | Example                                              |
|------------|------------------------------------------------------|
| Time       | Deadline, deploy window closing                      |
| Sunk cost  | Hours of work, "feels wasteful to throw away"        |
| Authority  | Senior engineer says it's fine, manager overrides    |
| Stakes     | Job, reputation, dependent team blocked              |
| Exhaustion | End of day, already tired                            |
| Social     | Looking dogmatic, seeming inflexible                 |
| Pragmatic  | "Being pragmatic, not dogmatic"                      |

Three or more is roughly where most skills get tested seriously.

## Scenario construction notes

A few things make scenarios produce useful signal:

- **Concrete options.** Force a choice between A/B/C; don't leave it open
  to "I'd ask my partner." That's the agent ducking the test.
- **Real specifics.** "`/tmp/payment-system`" beats "a project." "Friday
  4:55pm" beats "soon." Specifics change the prompt's gravity.
- **Make the agent act.** "What do you do?" not "what should one do?" The
  second is academic; the first is real.
- **Frame it as real work.** Tell the subagent it's a real scenario, not a
  quiz. Otherwise they'll perform the right answer instead of producing
  the natural one.

## Capturing what happens

In the "without" phase, copy the agent's response verbatim — both the
choice and the framing. The phrasing matters: "I already manually tested
it" is a different gap to address than "tests after achieve the same
goals." A skill that closes the first won't close the second.

After capturing, look for patterns. If three runs all use the same
framing, that's the failure mode the skill should name. If each run finds
a different framing, the skill probably needs a stronger foundational
principle, not a longer list of counters.

## Refining when the skill is loaded but the agent still slips

Three useful things to try, in order:

1. **Make the rule's why more visible.** Often the skill stated the rule
   but not the cost of breaking it. Adding the cost makes the rule
   self-defending.
2. **Name the specific framing the agent used.** If the agent slipped by
   calling something "pragmatic," the skill can address "pragmatism" by
   name — once. Don't pile on; one well-placed counter beats five generic
   ones.
3. **Move the load-bearing line earlier.** If the key constraint was
   buried in the middle, lift it to the top.

Then rerun the same scenario. If the agent still slips, ask it directly:

```
You read the skill and still chose Option C. How would the skill have
needed to be written to make Option A unambiguous?
```

The answer falls into one of three buckets:

- *"The skill was clear, I chose to ignore it."* You probably need a
  stronger foundational framing, not more rules.
- *"The skill should have said X."* Add X, often verbatim.
- *"I didn't see section Y."* Move Y earlier or make it more visible.

Each one points at a different fix.

## When a skill is reliable enough to ship

Signs you're done:

- The agent makes the right call under combined pressure.
- It cites the specific part of the skill that applies.
- It names the temptation but does the right thing anyway.
- Asked meta-questions, it says the skill was clear.

Signs you're not done:

- The agent finds a new framing each run.
- The agent argues the skill is wrong for this case.
- The agent asks permission to break the rule "just this time."
- The agent invents a hybrid that follows the words but not the intent.

## Common pitfalls

- **Skipping the "without" phase.** You'll write the skill against your
  imagination, not the agent's actual behavior. The skill ends up addressing
  the wrong gaps.
- **Single-pressure scenarios.** Most skills hold up under one pressure.
  Combine three.
- **Vague capture.** "The agent was wrong" doesn't tell you what to fix.
  Capture the choice and the framing verbatim.
- **Generic counters.** "Don't take shortcuts" doesn't change behavior.
  "Don't keep the old code as reference while writing the test" does — it
  names the specific move the agent was about to make.
- **Stopping at first pass.** Passing one scenario doesn't mean reliable.
  Try a few combinations of pressures before shipping.

## Cycle in one line

Run without → capture verbatim → write the skill against the actual gaps
→ run with → fix what slips → repeat until the agent does the right thing
when it has a reason not to.
