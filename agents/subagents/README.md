# Polytoken reviewer subagents

The `review-subagent` skill expects two Polytoken subagent types:

- `reviewer-1` for Correctness & Security plus Design & Structure.
- `reviewer-2` for Documentation & Comments plus Test Correctness.

The tracked shared prompt lives at:

```text
config/polytoken/subagents/reviewer-system-prompt.md
```

Real reviewer definitions are intentionally machine-local and ignored:

```text
config/polytoken/subagents/reviewer-*.md
```

Copy `examples/reviewer-1.md` and `examples/reviewer-2.md` into
`config/polytoken/subagents/`, then add a machine-specific `polytoken.model` if
needed. Omit `polytoken.model` to let the subagent use Polytoken's default model
selection.
