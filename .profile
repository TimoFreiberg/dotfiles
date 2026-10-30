export PATH="$HOME/dotfiles/bin:$PATH"

# Prefer Homebrew fish for programs that choose a shell from the environment.
if [ "$(uname -s)" = Darwin ] && [ -x /opt/homebrew/bin/fish ]; then
    export SHELL=/opt/homebrew/bin/fish
fi

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"
[ -f "$HOME/.atuin/bin/env" ] && . "$HOME/.atuin/bin/env"

# Expose globally configured mise tools in login Bash sessions.
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate bash --shims)"
fi
