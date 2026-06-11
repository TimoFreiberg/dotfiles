---
name: mermaid
description: "Use when creating or editing Mermaid diagrams — flowcharts, sequence/class/state diagrams, .mmd files, mermaid code blocks in Markdown. Validates syntax before the diagram ships."
---

# Mermaid Skill

Use this skill to validate Mermaid diagrams by parsing them with the mermaid library (no browser or Chromium needed).

## Prerequisites

- Node.js + npm (for `npx`).

## Tool

### Validate a diagram

```bash
"$HOME/dotfiles/agents/skills/mermaid/tools/validate.sh" diagram.mmd
```

- Parses the Mermaid source using the mermaid JS library.
- Non-zero exit = invalid Mermaid syntax.
- Prints an ASCII preview using `beautiful-mermaid` (best-effort; not all diagram types are supported).

## Workflow (short)

Every diagram you emit must pass `validate.sh` first — re-run until clean.

1. **If the diagram lives in Markdown**: work on it as a standalone `.mmd` file (the tool only validates plain Mermaid files). When editing an existing ```mermaid block, extract it to a temp `.mmd` first.
2. Write/update the `.mmd` file.
3. Run `"$HOME/dotfiles/agents/skills/mermaid/tools/validate.sh" diagram.mmd`.
4. Fix any errors shown by the parser.
5. Once it validates, copy the Mermaid block back into your Markdown file.
