# Polytoken reviewer subagents

`review-subagent` and `editing-documentation` launch `general-purpose` workers,
so neither needs a dedicated subagent type. Reviewers get a `model_override`
pointing at a `modelgroups` entry; the documentation editor uses the default
model.

The examples here are not part of any live pipeline:

- `reviewer-1`, `reviewer-2` predate model groups and the current three-axis
  split. They transclude a machine-local shared prompt at
  `config/polytoken/subagents/reviewer-system-prompt.md`.
- `documentation-editor` predates `editing-documentation` launching a
  `general-purpose` editor.

They are kept only as definition-shape references. To use one, copy it into
`config/polytoken/subagents/` (ignored, machine-local), add a
machine-specific `polytoken.model` if needed, and reload Polytoken.
