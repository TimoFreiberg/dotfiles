#!/bin/env fish

if test ! (type nvim)
    echo "nvim executable not found, install neovim"
    exit 1
end

if test (count $argv) -ne 1
    set NAME (basename (status filename))
    echo "USAGE: $NAME DCONF_BACKUP"
    echo "If you don't have a dconf backup file yet, create one via `dconf dump / > DCONF_BACKUP`"
    exit 1
end

set DCONF_BACKUP $argv[1]
set TMP (mktemp)

filtered-dconf.fish > $TMP

diff -U5 $DCONF_BACKUP $TMP | diff-highlighter.fish | bat