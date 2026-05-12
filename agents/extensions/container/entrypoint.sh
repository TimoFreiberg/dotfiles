#!/bin/sh
# entrypoint.sh — pi-container entrypoint
#
# Sets up pi's config directory from mounted dotfiles, then execs the command.
#
# The wrapper script (pi-docker) pre-populates:
#   /pi-config/auth.json            (from host's auth.json)
#   /pi-config/sessions/            (empty writable dir, or host mount with --persist)
#   /pi-config/prompt-history.jsonl (empty writable file)
#   /pi-config/todos.md             (empty writable file)
#
# This entrypoint copies remaining static config and symlinks live agent
# config from the mounted dotfiles directory into /pi-config.
#
# Mount expectations:
#   /dotfiles  → $HOME/dotfiles (read-only) — agents/, config/pi/agent/
#   /pi-config → writable overlay           — sessions, history, todos
#
# Environment:
#   PI_CODING_AGENT_DIR   config dir (defaults to /pi-config)
#   PI_DOTFILES_DIR       dotfiles mount point (defaults to /dotfiles)

set -e

PI_CONFIG="${PI_CODING_AGENT_DIR:-/pi-config}"
DOTFILES="${PI_DOTFILES_DIR:-/dotfiles}"

if [ -d "$DOTFILES/agents" ]; then
    mkdir -p "$PI_CONFIG"

    # --- Static config: copy (these are real files, not symlinks) ---
    for f in settings.json models.json; do
        src="$DOTFILES/config/pi/agent/$f"
        if [ -f "$src" ]; then
            cp "$src" "$PI_CONFIG/$f"
        fi
    done

    # --- Live agent config: symlink so edits to dotfiles take effect ---
    # Symlinks created inside the container, pointing to container paths —
    # no macOS→Linux path confusion since the container resolves them.
    for target in AGENTS.md skills extensions agents; do
        src="$DOTFILES/agents/$target"
        dst="$PI_CONFIG/$target"
        if [ -e "$src" ]; then
            ln -sf "$src" "$dst"
        fi
    done

    export PI_CODING_AGENT_DIR="$PI_CONFIG"
fi

exec "$@"
