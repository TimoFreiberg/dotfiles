# set -x PATH $PATH ~/bin ~/bin/nogit ~/.local/bin ~/.cabal/bin
# set -x PATH (echo $PATH | awk -v RS=' ' '!dedup[$1]++ {if (NR > 1) printf RS;  printf $1}')
set -x fish_user_paths ~/bin ~/bin/nogit ~/.local/bin ~/.emacs.d/bin ~/.cargo/bin

set -x EDITOR vim
set -x VISUAL vim
set -x XDG_CONFIG_HOME $HOME/.config
set -x EMACS_HOME $XDG_CONFIG_HOME/emacs/

if type starship > /dev/null 2>&1
    eval (starship init fish)
end

if type zoxide > /dev/null 2>&1
    function _zoxide_hook --on-variable PWD
        zoxide add
    end
end

# Abbreviations
if status is-interactive
    abbr --add --global :q exit
    abbr --add --global cal 'cal -3 -w -m'
    abbr --add --global g git
    abbr --add --global l exa 
    abbr --add --global ll exa -l
    abbr --add --global l1 ls-1A
    abbr --add --global la exa -la
    abbr --add --global ll 'ls -A'
    abbr --add --global pm pacman
    abbr --add --global sc systemctl
    abbr --add --global scX 'sudo systemctl start'
    abbr --add --global scr 'sudo systemctl restart'
    abbr --add --global scx 'sudo systemctl stop'
    abbr --add --global spr 'sudo pacman -R'
    abbr --add --global sps 'sudo pacman -S'
    abbr --add --global ssc 'sudo systemctl'
    abbr --add --global syu 'nice yay -Syu --devel --answerdiff=All'
    abbr --add --global tp trash
    abbr --add --global t tmux
    abbr --add --global v vim
    abbr --add --global c cargo
    abbr --add --global tn tmux-new
    abbr --add --global xb xsel -b
    abbr --add --global vimup 'nvim +PlugClean +PlugInstall +PlugUpdate'
    abbr --add --global zi 'z -i'
    abbr --add --global za 'zoxide add'
    abbr --add --global zq 'zoxide query'
    abbr --add --global zr 'zoxide remove'
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
    abbr --add --global gco 'git checkout'
    abbr --add --global gcb 'git checkout -b'
    abbr --add --global gcB 'git checkout -B'
    abbr --add --global gd 'git diff --stat'
    abbr --add --global gdd 'git diff'
    abbr --add --global gst 'git stash'
    abbr --add --global gre 'git remote'
    abbr --add --global grb 'git rebase'
    abbr --add --global grbc 'git rebase --continue'
    abbr --add --global grba 'git rebase --abort'
    abbr --add --global gpf 'git push --force-with-lease'
    abbr --add --global gfa 'git fetch --all --prune'
    abbr --add --global gpu 'git push --set-upstream origin HEAD'
    abbr --add --global gw 'git switch'

    if command -v exa > /dev/null 
        abbr --add --global l exa
        abbr --add --global ll 'exa -l'
        abbr --add --global la 'exa -la'
    end
end

if command -v zoxide > /dev/null
    function zoxide-add --on-event fish_prompt
        zoxide add
    end
end



setenv FZF_DEFAULT_COMMAND 'fd --type file --follow'
setenv FZF_CTRL_T_COMMAND 'fd --type file --follow'
setenv FZF_DEFAULT_OPTS '--height 20%'
