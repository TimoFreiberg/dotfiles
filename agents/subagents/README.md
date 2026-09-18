# Polytoken reviewer subagents

`review-subagent` launches `general-purpose` workers with a `model_override`
pointing at a `modelgroups` entry, so it needs no dedicated reviewer subagent
type. Only one definition here is still part of a live pipeline:

- `documentation-editor` — direct deletion and rewriting before and after review,
  driven by `editing-documentation`.

The `reviewer-1` and `reviewer-2` examples predate model groups and the current
three-axis split. They are kept only as definition-shape references; nothing
invokes them.

The reviewer examples transclude a machine-local shared prompt at:

```text
config/polytoken/subagents/reviewer-system-prompt.md
```

Install that prompt separately before using either reviewer example. The
`documentation-editor` example is self-contained.

Real reviewer and editor definitions are machine-local and ignored:

```text
config/polytoken/subagents/reviewer-*.md
config/polytoken/subagents/documentation-editor.md
```

Copy the example you want into `config/polytoken/subagents/`, then add a
machine-specific `polytoken.model` if needed. Omit `polytoken.model` to use
Polytoken's default model selection. Reload Polytoken after installing the new
definition so it discovers both the subagent and `editing-documentation` skill.
