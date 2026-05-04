---
name: extend-pi
description: "Use when working with the pi coding agent harness: extensions, skills, themes, prompt templates, TUI components, keybindings, SDK, custom providers, custom models, pi packages, custom tools. Points at pi's local docs and examples on disk."
user-invocable: false
---

# Extending pi

You're running inside pi, a minimal coding agent harness by @mariozechner. The
docs and examples shipped with pi are the contract for hooking into it — read
them before guessing at APIs.

This skill exists for setups that use a custom system prompt and therefore
drop pi's default "where to find pi docs" block. Without that pointer, the
agent has no idea where the surface area lives.

## Where the docs live

The npm-installed package ships `README.md`, `docs/`, and `examples/` under
its install root. Find the root with:

```bash
echo "$(npm root -g)/@mariozechner/pi-coding-agent"
```

All paths in the table below are relative to that directory.

## What's documented

| Topic               | Docs                       | Examples                                      |
|---------------------|----------------------------|-----------------------------------------------|
| Extensions          | `docs/extensions.md`       | `examples/extensions/`                        |
| Custom tools        | `docs/extensions.md`       | `examples/extensions/tools.ts`, `dynamic-tools.ts` |
| Skills              | `docs/skills.md`           | `examples/sdk/04-skills.ts`                   |
| Prompt templates    | `docs/prompt-templates.md` | `examples/sdk/08-prompt-templates.ts`         |
| Themes              | `docs/themes.md`           | —                                             |
| TUI components      | `docs/tui.md`              | `examples/extensions/` (UI-heavy ones)        |
| Keybindings         | `docs/keybindings.md`      | —                                             |
| SDK integration     | `docs/sdk.md`              | `examples/sdk/`                               |
| RPC mode            | `docs/rpc.md`              | `examples/extensions/rpc-demo.ts`             |
| JSON event stream   | `docs/json.md`             | —                                             |
| Custom providers    | `docs/custom-provider.md`  | `examples/extensions/custom-provider-*/`      |
| Custom models       | `docs/models.md`           | —                                             |
| Pi packages         | `docs/packages.md`         | —                                             |
| Settings            | `docs/settings.md`         | —                                             |
| Sessions            | `docs/sessions.md`, `docs/session-format.md` | —                            |
| Compaction          | `docs/compaction.md`       | `examples/extensions/custom-compaction.ts`    |

`examples/extensions/README.md` and `examples/sdk/README.md` index the example
files with one-line summaries each — read those first to find the closest
existing pattern.

## How to work on pi topics

1. Read the relevant `docs/*.md` completely. Pi's docs are short; skimming
   loses the constraint that bites you.
2. Follow cross-references. TUI work usually pulls in `tui.md` from
   `extensions.md`; provider work pulls in `models.md` from
   `custom-provider.md`.
3. Find the closest example in `examples/extensions/` or `examples/sdk/` and
   adapt it. The examples are the canonical "how to wire it up" reference.
4. Don't guess at the API surface — extension hooks, event names, and tool
   schemas are exact.
