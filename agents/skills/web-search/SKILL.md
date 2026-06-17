---
name: web-search
description: "Use when a question needs current internet information — docs, news, releases, prices. Prefer a built-in web search tool for quick lookups if the harness has one; this script returns a model-summarized answer with source URLs and works without one."
---

# Native Web Search

Use this skill to run a **fast model with native web search enabled** and get a concise research summary with explicit full URLs.

## Script

- `search.mjs`

## Usage

Works from any cwd:

```bash
node "$HOME/dotfiles/agents/skills/web-search/search.mjs" "<what to search>" --purpose "<why you need this>"
```

Examples:

```bash
node "$HOME/dotfiles/agents/skills/web-search/search.mjs" "latest python release" --purpose "update dependency notes"
node "$HOME/dotfiles/agents/skills/web-search/search.mjs" "vite 7 breaking changes" --purpose "prepare migration checklist"
```

Optional flags:

- `--provider gemini|openai-codex|anthropic`
- `--model <model-id>`
- `--timeout <ms>`
- `--json`

## Setup

Set `GEMINI_API_KEY` (free key from https://aistudio.google.com/apikey) or add `{"gemini": {"key": "..."}}` to `auth.json`
(in `$PI_CODING_AGENT_DIR`, default `~/.config/pi/agent/`).
Falls back to OpenAI Codex / Anthropic if configured in `auth.json`.

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full canonical URLs (`https://...`) for each key finding
- highlight disagreements between sources

## Notes

- No extra npm install is required.
- If module resolution fails, set `PI_AI_MODULE_PATH` to pi-ai's `dist/index.js` (try `@earendil-works/pi-ai` first; older installs may still use `@mariozechner/pi-ai`).
- Verify auth without spending a search call: `node search.mjs --check --provider anthropic`. This resolves credentials (including refreshing an expired OAuth token) and prints `OK` or a clear failure. Use it after `/login` or when a search returns an auth error.
