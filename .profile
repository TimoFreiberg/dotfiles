export PATH="$HOME/dotfiles/bin:$PATH"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"
[ -f "$HOME/.atuin/bin/env" ] && . "$HOME/.atuin/bin/env"

# Expose globally configured mise tools in login Bash sessions.
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate bash --shims)"
fi
