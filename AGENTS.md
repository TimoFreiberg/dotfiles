# Guidelines for my dotfiles repo

## Symlink layout

This repo is the backing store for all agent and shell config. The canonical
source for agent configuration is the `agents/` directory. Everything else
symlinks into it:

| Real path (in repo)          | Symlink                              | Purpose                            |
|------------------------------|--------------------------------------|------------------------------------|
| `agents/AGENTS.md`          | `claude/CLAUDE.md` → `../agents/AGENTS.md` | Global agent instructions (shared) |
| `agents/AGENTS.md`          | `config/pi/agent/AGENTS.md` → `../../../agents/AGENTS.md` | Same file, read by Pi              |
| `AGENTS.md` (repo root)     | `CLAUDE.md` → `AGENTS.md`           | Project-level instructions         |
| `agents/skills/`            | `claude/skills/`, `config/pi/agent/skills/` | Shared skill definitions           |
| `agents/references/`        | `claude/references/`                 | Reference docs for skills          |
| `agents/extensions/`        | `config/pi/agent/extensions/`        | Pi extensions                      |
| `agents/agents/`            | `config/pi/agent/agents/`            | Pi agent definitions               |
| `config/`                   | `~/.config` → `~/dotfiles/config`    | Shell & app config (fish, etc.)    |
| `claude/`                   | `~/.claude` → `~/dotfiles/claude`    | Claude Code config dir             |
| (external, varies per machine) | `claude/memories/`              | Persistent agent memories          |

**Key rule:** edit files in `agents/`, not through the symlinks. The repo-root
`AGENTS.md` (project instructions) and `agents/AGENTS.md` (global instructions)
are two different files — don't confuse them.

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
