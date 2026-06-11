---
name: summarize
description: "Use when asked to summarize, read, or convert a PDF, DOCX, PPTX, HTML file, or URL — converts to Markdown via markitdown, with an optional model-written summary."
---

Turn “things” (URLs, PDFs, Word docs, PowerPoints, HTML pages, text files, etc.) into **Markdown** so they can be inspected/quoted/processed like normal text.

`markitdown` can fetch URLs by itself; this skill mainly wraps it to make saving + summarizing convenient.
The wrapper uses the `markitdown[pdf]` extra automatically, so PDF inputs just work.

## When to use

Use this skill when you need to:
- pull down a web page as a document-like Markdown representation
- convert binary docs (PDF/DOCX/PPTX) into Markdown for analysis
- quickly produce a short summary of a long document before deeper work

## Quick usage

### Convert a URL or file to Markdown

The wrapper works from any cwd:

```bash
node "$HOME/dotfiles/agents/skills/summarize/to-markdown.mjs" <url-or-path> --tmp
```

- `--tmp` writes Markdown to a temp file and prints the path.
- `--out <file>` writes to a specific file instead.
- Without either, Markdown goes to stdout (raw `uvx --from 'markitdown[pdf]' markitdown <url-or-path>` does the same).

If conversion fails (auth-walled or JS-heavy pages, unsupported formats),
fall back to fetching/reading the source directly or ask the user.

### Convert + summarize with haiku-4-5 (pass context!)

Summaries are only useful when you provide **what you want extracted** and the **audience/purpose**.

```bash
node "$HOME/dotfiles/agents/skills/summarize/to-markdown.mjs" <url-or-path> --summary --prompt "Summarize focusing on X, for audience Y. Extract Z."
```

This will:
1) convert to Markdown via `uvx --from 'markitdown[pdf]' markitdown`
2) write the full Markdown to a temp `.md` file and print its path as a "Hint" line (always — so you can open/inspect the full content)
3) run `pi --model claude-haiku-4-5` (no-tools, no-session) to summarize using your extra prompt (`--summary-prompt` is an alias for `--prompt`)
