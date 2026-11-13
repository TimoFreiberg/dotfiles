# Dotfiles lint targets

# Run all linters
lint: lint-sh lint-fish

# Shellcheck bash/sh scripts
lint-sh:
    shellcheck bin/*.sh

# Check fish formatting
lint-fish:
    fish_indent --check config/fish/config.fish config/fish/functions/*.fish

# Test the plan-view hook with a stub command (no Lavish session)
test-lavish-plan-view:
    node --test agents/hooks/test/lavish-plan-view.test.mjs
