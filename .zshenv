. "$HOME/.cargo/env"

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# Deduplicate PATH while preserving priority.
typeset -U path PATH

path=(
  "$HOME/dotfiles/bin"
  "$HOME/.bun/bin"
  "$HOME/.local/bin"
  "$HOME/.cargo/bin"
  /opt/homebrew/opt/openssl@1.1/bin
  /opt/homebrew/bin
  "$HOME/bin"
  "$HOME/bin/nogit"
  $path
)

# Remove entries that do not exist.
path=(${^path}(N-/))
export PATH

# Make fish-format secrets (set -x NAME VALUE) available to zsh agent/script shells.
# Secrets stay only in secrets.fish (single source of truth); this just translates them
# at init. Guarded so a parse hiccup can never abort .zshenv.
if [[ -r "$HOME/.local/share/fish/secrets.fish" ]]; then
  while read -r __k __f __n __v; do
    [[ $__k == set && -n $__n ]] || continue
    __v=${__v#[\"\']}; __v=${__v%[\"\']}   # strip surrounding quotes if any
    export "$__n=$__v"
  done < "$HOME/.local/share/fish/secrets.fish"
  unset __k __f __n __v
fi
