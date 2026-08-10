# Polytoken reviewer subagents

The review pipeline uses three Polytoken subagent types:

- `reviewer-1` for Correctness & Security plus Design & Structure;
- `reviewer-2` for Test Correctness;
- `documentation-editor` for direct deletion and rewriting before and after
  review.

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

Copy `examples/reviewer-1.md`, `examples/reviewer-2.md`, and
`examples/documentation-editor.md` into `config/polytoken/subagents/`, then add
a machine-specific `polytoken.model` if needed. Omit `polytoken.model` to use
Polytoken's default model selection. Reload Polytoken after installing the new
definition so it discovers both the subagent and `editing-documentation` skill.
