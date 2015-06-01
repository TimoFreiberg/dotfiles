# set -x PATH $PATH ~/bin ~/bin/nogit ~/.local/bin ~/.cabal/bin
# set -x PATH (echo $PATH | awk -v RS=' ' '!dedup[$1]++ {if (NR > 1) printf RS;  printf $1}')
fish_add_path ~/bin
fish_add_path ~/bin/nogit
fish_add_path ~/.local/bin
fish_add_path ~/.emacs.d/bin
fish_add_path ~/.cargo/bin
fish_add_path /usr/local/google-cloud-sdk/bin
fish_add_path /opt/homebrew/bin
fish_add_path /opt/homebrew/opt/openssl@1.1/bin

set -x EDITOR nvim
set -x VISUAL nvim
set -x XDG_CONFIG_HOME $HOME/.config
set -x EMACS_HOME $XDG_CONFIG_HOME/emacs/
set -x NOTE_FILE ~/Dropbox/notes/notes.md

if type starship > /dev/null 2>&1
    eval (starship init fish)
end

# Abbreviations
if status is-interactive
    abbr --add --global :q exit
    abbr --add --global cal 'cal -3 -w -m'
    abbr --add --global g git
    abbr --add --global l1 ls-1A
    abbr --add --global pm pacman
    abbr --add --global sc systemctl
    abbr --add --global scu 'systemctl --user'
    abbr --add --global scX 'sudo systemctl start'
    abbr --add --global scr 'sudo systemctl restart'
    abbr --add --global scx 'sudo systemctl stop'
    abbr --add --global spr 'sudo pacman -Rs'
    abbr --add --global sps 'sudo pacman -S'
    abbr --add --global ssc 'sudo systemctl'
    abbr --add --global syu 'nice paru -Syu --devel --upgrademenu'
    abbr --add --global rsup 'rustup update; cargo sweep --installed -r ~/code'
    abbr --add --global vimup 'nvim +PlugClean +PlugInstall +PlugUpdate'
    abbr --add --global tp trash
    abbr --add --global t tmux
    abbr --add --global v vim
    abbr --add --global c cargo
    abbr --add --global tn tmux-new
    abbr --add --global xb xsel -b
    abbr --add --global zi 'z -i'
    abbr --add --global wlp 'wl-paste'
    abbr --add --global wlc 'wl-copy'

    # git aliases
    abbr --add --global gl 'git log'
    abbr --add --global gs 'git status --short'
    abbr --add --global gss 'git status'
    abbr --add --global ga 'git add'
    abbr --add --global gai 'git add --interactive'
    abbr --add --global gps 'git push'
    abbr --add --global gpl 'git pull'
    abbr --add --global gf 'git fetch'
    abbr --add --global gc 'git commit --verbose'
    abbr --add --global gca 'git commit --all --verbose'
    abbr --add --global gam 'git commit --all --verbose --amend'
    abbr --add --global gamn 'git commit --all --amend --no-edit'
    abbr --add --global gdt 'git difftool'
    abbr --add --global gdtg 'git difftool --gui'
    abbr --add --global gmt 'git mergetool'
    abbr --add --global gb 'git branch'
    abbr --add --global gbd 'git branch --delete'
    abbr --add --global gbdf 'git branch --delete --force'
    abbr --add --global gco 'git checkout'
    abbr --add --global gcb 'git checkout -b'
    abbr --add --global gcB 'git checkout -B'
    abbr --add --global gd 'git diff --stat'
    abbr --add --global gdd 'git diff'
    abbr --add --global gst 'git stash'
    abbr --add --global gre 'git remote'
    abbr --add --global gr 'git reset'
    abbr --add --global grh 'git reset --hard'
    abbr --add --global grH 'git reset HEAD^'
    abbr --add --global grb 'git rebase'
    abbr --add --global grbc 'git rebase --continue'
    abbr --add --global grba 'git rebase --abort'
    abbr --add --global gpf 'git push --force-with-lease'
    abbr --add --global gfa 'git fetch --all --prune'
    abbr --add --global gw 'git switch'
    abbr --add --global gwc 'git switch --create'
    abbr --add --global gcp 'git cherry-pick'
    abbr --add --global gm 'git merge'
    abbr --add --global gmc 'git merge --continue'
    abbr --add --global gma 'git merge --abort'
    abbr --add --global grv 'git revert'


    if command -v eza > /dev/null
        abbr --add --global l eza
        abbr --add --global ll 'eza -l'
        abbr --add --global la 'eza -la'
    end
end

setenv FZF_DEFAULT_COMMAND 'fd --type file --follow'
setenv FZF_CTRL_T_COMMAND 'fd --type file --follow'
setenv FZF_DEFAULT_OPTS '--height 20%'

type -q zoxide && zoxide init fish | source

# type -q chef && eval (chef shell-init fish)

test -e {$HOME}/.iterm2_shell_integration.fish ; and source {$HOME}/.iterm2_shell_integration.fish
test -e ./fastly-config.fish && source ./fastly-config.fish
