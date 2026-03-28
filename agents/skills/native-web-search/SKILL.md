---
name: native-web-search
description: "Quick internet research via a web-search-enabled model. Returns summaries with source URLs."
---

# Native Web Search

Use this skill to run a **fast model with native web search enabled** and get a concise research summary with explicit full URLs.

## Script

- `search.mjs`

## Usage

Run from this skill directory:

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

Examples:

```bash
node search.mjs "latest python release" --purpose "update dependency notes"
node search.mjs "vite 7 breaking changes" --purpose "prepare migration checklist"
```

Optional flags:

- `--provider gemini|openai-codex|anthropic`
- `--model <model-id>`
- `--timeout <ms>`
- `--json`

## Setup

Set `GEMINI_API_KEY` (free key from https://aistudio.google.com/apikey) or add `{"gemini": {"key": "..."}}` to `auth.json`.
Falls back to OpenAI Codex / Anthropic if configured in `auth.json`.

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full canonical URLs (`https://...`) for each key finding
- highlight disagreements between sources

## Notes

- No extra npm install is required.
- If module resolution fails, set `PI_AI_MODULE_PATH` to `@mariozechner/pi-ai`'s `dist/index.js` path.
