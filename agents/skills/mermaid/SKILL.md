---
name: mermaid
description: "Must read guide on creating/editing mermaid charts with validation tools"
---

# Mermaid Skill

Use this skill to validate Mermaid diagrams by parsing them with the mermaid library (no browser or Chromium needed).

## Prerequisites

- Node.js + npm (for `npx`).

## Tool

### Validate a diagram

```bash
./tools/validate.sh diagram.mmd
```

- Parses the Mermaid source using the mermaid JS library.
- Non-zero exit = invalid Mermaid syntax.
- Prints an ASCII preview using `beautiful-mermaid` (best-effort; not all diagram types are supported).

## Workflow (short)

1. **If the diagram will live in Markdown**: draft it in a standalone `diagram.mmd` first (the tool only validates plain Mermaid files).
2. Write/update `diagram.mmd`.
3. Run `./tools/validate.sh diagram.mmd`.
4. Fix any errors shown by the parser.
5. Once it validates, copy the Mermaid block into your Markdown file.
