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
| `config/polytoken/AGENTS.md` | `agents/AGENTS.md` → `../config/polytoken/AGENTS.md` | Global source used by Polytoken and shared agent consumers |
| `config/polytoken/AGENTS.md` | `config/pi/agent/AGENTS.md` → `../../../agents/AGENTS.md` | Same source, read by Pi |
| `config/polytoken/AGENTS.md` | `~/.config/polytoken/AGENTS.md` (chezmoi) | Deployed regular copy for the new home layout |
| `AGENTS.md` (repo root)     | —                                  | Repository instructions (not deployed global instructions) |
| `agents/skills/`            | `config/pi/agent/skills/` → `../../../agents/skills/` | Shared skill definitions |
| `agents/references/`        | `claude/references` → `../agents/references` (legacy) | Shared references retained for unmigrated legacy paths |
| `agents/extensions/`        | `config/pi/agent/extensions/`       | Pi extensions |
| `agents/agents/`            | `config/pi/agent/agents/`            | Pi agent definitions |
| `config/`                   | `~/.config` → `~/dotfiles/config` (legacy only) | Shell and app config before chezmoi cutover |
| `(external, varies per machine)` | `claude/memories/` (legacy only) | Private state; back up before helper retires `~/.claude` |

**Key rule:** edit real files, not through the symlinks. The real global
instructions file is `config/polytoken/AGENTS.md` (intentional: Polytoken reads
that path directly and avoids following symlinks); `agents/AGENTS.md` and
`config/pi/agent/AGENTS.md` are symlinks into it. On a migrated home, chezmoi
materializes `~/.config/polytoken/AGENTS.md` as a regular file. The `claude/`
entries are legacy compatibility paths only; Claude Code-specific settings and
hooks are retired. The repo-root `AGENTS.md` is a separate project-instructions
file.

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
