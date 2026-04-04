# Dotfiles lint targets

# Run all linters
lint: lint-sh lint-fish

# Shellcheck bash/sh scripts
lint-sh:
    shellcheck bin/*.sh claude/hooks/*.sh

# Check fish formatting
lint-fish:
    fish_indent --check config/fish/config.fish config/fish/functions/*.fish
