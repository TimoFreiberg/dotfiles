---
name: writing-claude-directives
description: "Use when writing instructions that guide an agent: skills, CLAUDE.md/AGENTS.md files, system prompts, agent prompts. Covers token efficiency, discovery, compliance, and the small repertoire of patterns that earn their keep."
user-invocable: false
---

# Writing Claude Directives

Directives are instructions someone (a future you, a teammate's agent, a
subagent) loads when they're working on something. Good directives say only
what the reader doesn't already know, in a shape that's easy to find and act
on.

Pair this with [prompt-security-hardening](../prompt-security-hardening/SKILL.md)
when the directive touches secrets, shell commands, or credential flows —
unsafe patterns in directives propagate to the code agents write next.

## Principles

**The reader is competent.** Skip the basics. A line that doesn't change
behavior costs tokens without paying for them. Challenge each line: what
would change if I deleted this?

**Say what to do, not what not to do.** "Don't create duplicate files"
primes the reader to think about creating duplicate files. "Update existing
files in place" points at the right move. Negative framing has its place
(genuine traps, hard prohibitions), but the default is positive.

**Explain why once.** A motivation sentence generalizes — the reader can
extrapolate to cases the rule didn't anticipate. "Run tests before commit
because untested commits break CI for the team" beats a bare "run tests
before commit." Don't repeat the why every time the rule applies; once is
enough.

**Placement matters.** First and last lines of a prompt get the most
attention. Put critical constraints at the boundaries.

**~150 instructions is a soft ceiling.** Past that, all rules get fuzzier —
not just the new ones. If you're adding rule 151, prune one first.

**Repeat genuinely critical rules with different framings.** Once for the
top, once where it's relevant in flow, once in a checklist if there is one.
The bar for repetition is "the cost of getting this wrong is high."

## Token economy

Rough targets:

- Frequently-loaded directives (always-on AGENTS.md additions): under ~200 words.
- Skills / CLAUDE.md files: under ~500 lines total, main file under ~150.
- Reference `--help` instead of documenting every flag.
- Cross-link sibling skills instead of inlining their content.

Use progressive disclosure: the main file is overview + structure + links;
companion files (`reference.md`, `examples.md`) load on demand when the
agent needs the depth.

## Discovery (especially for skills)

The `description` field is what the agent searches against when deciding
whether to load the skill. Treat it like a search query the user would type.

Format:

```yaml
description: "Use when <symptom or trigger>, <symptom>, or <symptom> — <what the skill does, third person>"
```

Third person matters: the description is injected into the system prompt as
if the harness is describing the skill, not as if the skill is talking to
the user.

Bad:

```yaml
description: I help with async testing
```

Good:

```yaml
description: "Use when tests have race conditions, timing dependencies, or arbitrary sleeps — replaces timeouts with condition polling."
```

Include the words the agent would actually search for: error messages, tool
names, symptoms. If a skill is about flaky tests, "flaky" should appear in
the description.

## Compliance techniques

Most current models follow clear instructions readily. Lead with context and
motivation; reserve emphatic language for the small set of genuinely critical
rules.

**Primary lever — context and motivation:**

```markdown
Run tests before committing. Untested commits break CI for the team and
block other developers from merging.
```

A motivated rule is a rule the reader can apply to cases you didn't list.

**Secondary lever — structure:**

| Pattern              | Effect                                                   |
|----------------------|----------------------------------------------------------|
| Numbered steps       | Compliance becomes "do step N", not "remember to do X"   |
| Checklists           | Catches the step that gets skipped under time pressure   |
| Explicit branches    | "If X, do Y instead" beats "consider doing Y"            |
| Worked example       | One concrete trace beats abstract description            |

**When to escalate to imperatives.** Bold or all-caps when there's a real
trap with a costly failure mode (e.g. "**NEVER** run `jj squash` without
`-m`" — bare squash hangs on an editor). Keep this register rare so it
keeps its weight.

## Structure patterns that earn their keep

**XML for multi-part prompts.** Models parse `<task>`, `<constraints>`,
`<examples>` cleanly. Useful when you're constructing a prompt for a
subagent and want the parts visually separated.

```xml
<task>What to accomplish</task>
<constraints>Hard requirements</constraints>
<output_format>Expected structure</output_format>
```

**Match prompt style to desired output.** Markdown in the prompt nudges
markdown out. Plain prose in the prompt nudges plain prose out. If you want
JSON back, show JSON in the prompt.

**Workflow blocks for multi-step tasks.** Numbered list, optional
checklist, verification gates between steps:

```markdown
1. Analyze inputs
2. Generate plan
3. Validate plan against [constraint]
4. Execute
5. Verify output
```

**Feedback loops for self-correcting tasks.** "Run validator → fix errors →
re-run → only proceed when clean" is more reliable than "be careful."

## Specificity vs. freedom

Match the directive's tightness to the cost of getting the thing wrong:

| Risk profile          | How tight                          | Example                                    |
|-----------------------|------------------------------------|--------------------------------------------|
| Fragile, irreversible | Exact script, no improvisation     | "Run this exact command, in this order"    |
| Preferred pattern     | Template with parameters           | "Use this shape, fill in the specifics"    |
| Context-dependent     | Principles + heuristics            | "Optimize for X; here's how to think about it" |

Tight directives constrain; loose directives empower. Both are right answers
for different situations.

## Naming

For skills:

- Lowercase, hyphenated.
- Gerund-form for techniques: `writing-skills`, `testing-skills-with-subagents`.
- Action or insight, not a category: `condition-based-waiting`, not `async-helpers`.

For CLAUDE.md / AGENTS.md sections, use `## Title Case` headings the agent
can grep for.

## Overengineering nudge

If the directive is for an agent that tends to overbuild, add one paragraph
near the top:

```markdown
Make only the changes that are directly requested or clearly necessary. A
bug fix doesn't need a surrounding refactor. A simple feature doesn't need
extra configurability. Trust framework guarantees and validate at system
boundaries; don't validate against scenarios that can't happen.
```

This is more useful than scattering "don't overengineer" reminders through
the rest of the directive.

## Common mistakes

| Mistake                                  | Fix                                                          |
|------------------------------------------|--------------------------------------------------------------|
| Padding obvious context the agent has    | Cut it. The agent reads quickly and gets bored fast.        |
| Multiple valid approaches with no default| Pick one default; mention the escape hatch for edge cases.  |
| Vague triggers in `description`          | Use the specific symptoms / errors a user would search for. |
| Deeply nested cross-references           | Keep one level deep from the main file.                      |
| Aggressive imperatives everywhere        | Reserve emphasis for genuine traps.                          |

## Verifying

For directives that change behavior under pressure, test before deploying —
see [testing-skills-with-subagents](../testing-skills-with-subagents/SKILL.md).
For pure reference directives, the test is simpler: read it back as if you
hadn't written it and check whether the answer to "what should I do?" is
unambiguous.
