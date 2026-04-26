---
name: writing-skills
description: "Use when creating, editing, or reviewing a skill before it ships. Covers when to write a skill, file layout, the SKILL.md shape, and how to verify it before relying on it."
user-invocable: false
---

# Writing Skills

A skill is process documentation that another agent (or future you) loads when
the trigger fits. Treat it like any other piece of code: write it for the
reader who'll use it, verify it does what you think, and don't ship until
you've watched it work.

Foundations live in [writing-claude-directives](../writing-claude-directives/SKILL.md)
(token efficiency, discovery, compliance). This skill is about skill-shaped
directives specifically: when to make one, how to structure it, how to test it.

## When a skill is the right tool

A skill earns its place when:

- The technique isn't obvious from the codebase or the task description.
- You'd want to apply it across projects, not just this one.
- The pattern is general enough that someone hitting the same situation later
  would benefit from the same playbook.

Don't write a skill for:

- One-off solutions to a specific bug.
- Standard practices already documented in the language/framework docs.
- Project-specific conventions — those go in `CLAUDE.md` / `AGENTS.md`.

If you're unsure, the question to ask is "would I link a colleague to this six
months from now?"

## Skill types

Most skills land in one of three shapes:

| Type      | What it is                                | Examples                              |
|-----------|-------------------------------------------|---------------------------------------|
| Technique | Concrete method with steps                | `dev-review-loop`, `condition-based-waiting` |
| Pattern   | Mental model for a class of problem       | `flatten-with-flags`, `test-invariants` |
| Reference | API / syntax / tool docs in skill form    | `jj`, `prometheus`                    |

The shape changes how you write it (technique skills have steps; reference
skills have tables). Pick early so the structure follows.

## Directory layout

```
skills/
  skill-name/
    SKILL.md              # main entry (required)
    reference.md          # optional: heavy reference content
    helper.sh             # optional: scripts the skill calls
```

Default to a single `SKILL.md`. Split out reference files when the main file
crosses ~150 lines and the extra content is genuinely "load on demand" (rare
flags, advanced syntax, edge-case recipes). Don't preemptively split.

## SKILL.md template

```markdown
---
name: skill-name
description: "Use when [trigger/symptom] — [what it does, third person]"
user-invocable: false   # omit if the user can invoke via slash command
---

# Skill Name

One or two sentences on what this skill is for and when it earns its keep.

## When to use

Symptoms or situations that should make the agent reach for this. If there
are common cases where it does *not* apply, name them.

## Core idea

The one thing that, if internalized, makes the rest follow. Often a
before/after, a key technique, or a pithy framing.

## Steps / patterns / reference

The body of the skill. Format depends on the type — steps for techniques,
tables for reference, before/after for patterns.

## Common mistakes

The things that bite people. Each one with a short fix.
```

Frontmatter notes:

- `name`: lowercase, hyphenated, gerund-ish for techniques (`writing-skills`,
  `debugging-flakes`).
- `description`: starts with "Use when…", reads in third person. This is the
  string the agent searches against — load it with the symptoms a future
  agent would actually type.
- `user-invocable: false` for skills that the model loads on its own, not via
  `/skill-name`. Omit (or set true) for slash-command skills.

## Verifying a skill before relying on it

Before shipping a discipline-enforcing skill, run it through
[testing-skills-with-subagents](../testing-skills-with-subagents/SKILL.md):

1. Run the realistic scenario *without* the skill loaded. See what the agent
   actually does. Capture the wording verbatim.
2. Write the skill to address those specific failures.
3. Re-run with the skill loaded. Watch it work.
4. Find the loopholes the agent finds, close them, re-run.

For pure reference skills (API docs, syntax) the test is simpler: ask the
skill the kind of question you'd ask a colleague, and see if it answers.

The cheap version of all of this: read the skill back as if you'd never seen
it before and weren't the one who wrote it. If the trigger conditions are
fuzzy, or you'd skim past the key constraint, fix that before shipping.

## Anti-patterns to avoid

- **Narrative dated examples.** "In session 2025-10-03 we found…" — too
  specific, doesn't reuse.
- **Multi-language dilution.** Writing the same example in JS, Python, Rust
  to "be inclusive" usually means three mediocre examples instead of one good
  one. Pick one language and label the conceptual point.
- **Code embedded in flowcharts.** Can't copy-paste, hard to read. Code goes
  in code blocks.
- **Generic placeholder names.** `step1`, `helper2`, `thing` — give them
  semantic names so the reader can follow what they do.
- **Copy of project-specific lore.** That belongs in `CLAUDE.md` / `AGENTS.md`,
  not here.

## Cross-references

When a skill leans on another, link to the sibling SKILL.md by relative path:

```markdown
See [testing-skills-with-subagents](../testing-skills-with-subagents/SKILL.md)
for the pressure-testing methodology.
```

Plain markdown links keep the skills portable across plugins and dotfiles.
