# Guidelines for my dotfiles repo

## Symlink layout

This repo is the backing store for all agent and shell config. The canonical
source for agent configuration is the `agents/` directory, with one deliberate
exception: the global agent instructions chain is rooted in
`config/polytoken/` — Polytoken reads that path directly and avoids following
symlinks, so the real global-instructions file lives there and everything else
symlinks into it:

| Real path (in repo)          | Symlink                              | Purpose                            |
|------------------------------|--------------------------------------|------------------------------------|
| `config/polytoken/AGENTS.md` | `agents/AGENTS.md` → `../config/polytoken/AGENTS.md` | Real global-instructions file, loaded by Polytoken directly |
| `config/polytoken/AGENTS.md` | `claude/CLAUDE.md` → `../agents/AGENTS.md` | Global agent instructions (shared) |
| `config/polytoken/AGENTS.md` | `config/pi/agent/AGENTS.md` → `../../../agents/AGENTS.md` | Same file, read by Pi              |
| `AGENTS.md` (repo root)     | `CLAUDE.md` → `AGENTS.md`           | Project-level instructions         |
| `agents/skills/`            | `claude/skills/`, `config/pi/agent/skills/` | Shared skill definitions           |
| `agents/references/`        | `claude/references/`                 | Reference docs for skills          |
| `agents/extensions/`        | `config/pi/agent/extensions/`        | Pi extensions                      |
| `agents/agents/`            | `config/pi/agent/agents/`            | Pi agent definitions               |
| `config/`                   | `~/.config` → `~/dotfiles/config`    | Shell & app config (fish, etc.)    |
| `claude/`                   | `~/.claude` → `~/dotfiles/claude`    | Claude Code config dir             |
| (external, varies per machine) | `claude/memories/`              | Persistent agent memories          |

**Key rule:** edit real files, not through the symlinks. The real global
instructions file is `config/polytoken/AGENTS.md` (intentional: Polytoken reads
that path directly and avoids following symlinks); `agents/AGENTS.md`,
`claude/CLAUDE.md`, and `config/pi/agent/AGENTS.md` are all symlinks into it.
The repo-root `AGENTS.md` (project instructions) and the global instructions
file are two different files — don't confuse them.

## Portability

- Must work on both macOS and Linux (desktop Linux not actively used but don't break it)
- Assume the repo lives at `~/dotfiles`, but never hardcode the home directory
  path — use `$HOME`. The username varies across machines (`timo`, `tfreiberg`)
- No private identifying info, API keys, secrets, or work-specific details in
  this repo. It's public.
- In hook scripts and configs, use `$HOME` not `~` (tilde doesn't expand in
  most non-shell contexts like JSON config, Python, permission rule patterns)

## Version Control

After committing, the current change should be empty.
**Update the main bookmark** at the end: `jj bookmark set main -r @-`
