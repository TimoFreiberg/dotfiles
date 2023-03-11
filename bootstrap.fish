#!/usr/bin/env fish

cd (dirname (status --current-filename))

set DOTFILEDIR (pwd)
set HOMEDIR $HOME
set tmpdir (mktemp -d)

function backup_dotfile
    set f $HOMEDIR/$argv
    if test -e $f
        echo "moving $f to $tmpdir/$argv"
        mv $f $tmpdir/$argv
    end
end

function symlink_dotfile
    ln -s $DOTFILEDIR/$argv $HOMEDIR/$argv
end

set DOTFILES bin Wallpapers .spacemacs .tmux.conf 

for dotfile in $DOTFILES
    backup_dotfile $dotfile
    symlink_dotfile $dotfile
end

backup_dotfile .config
ln -s $DOTFILEDIR/config $HOMEDIR/.config

backup_dotfile .gitconfig
echo "[user]
    name =
    email =

[include]
    path=$DOTFILEDIR/gitconfig.ini
" > ~/.gitconfig

echo "Add name and email to ~/.gitconfig"

# mac only
defaults write com.apple.dock autohide-delay -float 0 && defaults write com.apple.dock autohide-time-modifier -float 0.4 && killall Dock

