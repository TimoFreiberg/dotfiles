# set -x PATH $PATH ~/bin ~/bin/nogit ~/.local/bin ~/.cabal/bin
# set -x PATH (echo $PATH | awk -v RS=' ' '!dedup[$1]++ {if (NR > 1) printf RS;  printf $1}')
set -x fish_user_paths ~/bin ~/bin/nogit ~/.local/bin ~/.emacs.d/bin ~/.cargo/bin

set -x EDITOR vim
set -x VISUAL vim

if type starship > /dev/null 2>&1
    eval (starship init fish)
end

# Abbreviations
abbr --add :q exit
abbr --add cal 'cal -3 -w -m'
abbr --add g git
abbr --add l exa 
abbr --add ll exa -l
abbr --add l1 ls-1A
abbr --add la exa -la
abbr --add ll 'ls -A'
abbr --add pm pacman
abbr --add sc systemctl
abbr --add scX 'sudo systemctl start'
abbr --add scr 'sudo systemctl restart'
abbr --add scx 'sudo systemctl stop'
abbr --add spr 'sudo pacman -R'
abbr --add sps 'sudo pacman -S'
abbr --add ssc 'sudo systemctl'
abbr --add syu 'sudo pacman -Syu'
abbr --add tp trash
abbr --add t tmux
abbr --add v vim
abbr --add c cargo
abbr --add tn tmux-new
abbr --add xb xsel -b
abbr --add vimup 'nvim +PlugClean +PlugInstall +PlugUpdate'
abbr --add zi 'z -i'
abbr --add za 'zoxide add'
abbr --add zq 'zoxide query'
abbr --add zr 'zoxide remove'

if command -v zoxide > /dev/null
    function zoxide-add --on-event fish_prompt
        zoxide add
    end
end


if command -v exa > /dev/null 
    abbr --add l exa
    abbr --add ll 'exa -l'
    abbr --add la 'exa -la'
end

setenv FZF_DEFAULT_COMMAND 'fd --type file --follow'
setenv FZF_CTRL_T_COMMAND 'fd --type file --follow'
setenv FZF_DEFAULT_OPTS '--height 20%'
