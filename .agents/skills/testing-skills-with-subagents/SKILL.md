---
name: testing-skills-with-subagents
description: "Use when verifying that a skill works before relying on it. Pressure-tests skills with subagents: runs the scenario without the skill, compares to with the skill, iterates until the behavior is reliable."
---

A skill is proven only when an agent in the situation behaves differently
with it. Test skills that enforce a discipline the agent has a reason to
skip; workflow and reference skills test themselves on first use.

1. Without: run the scenario in three fresh subagents with no skill text, on
   the model that will use the skill. Make sure they can't load the installed
   skill on their own. Capture each choice and its reasoning verbatim; the
   agent's own framing ("I already tested it manually") is the gap the skill
   has to close.
2. Write the skill against those gaps, not imagined ones.
3. With: rerun with the skill text pasted verbatim into the prompt, ideally
   on a model one tier smaller.
4. Refine what still slips: say what breaking the rule costs, name the
   framing the agent used (once), or move the key line earlier. Ask a
   slipping agent how the skill would have had to be written to stop it.

A useful scenario makes following the skill cost something. Combine three or
more pressures (deadline, sunk cost, an authority saying it's fine, end-of-day
fatigue), use concrete specifics, and force a choice between named options,
framed as real work rather than a quiz. "What does the skill say?" tests
nothing.

Done when the agent makes the right call under combined pressure across runs;
not done while each run finds a new framing or argues the rule doesn't apply.
