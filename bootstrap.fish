#!/usr/bin/env fish

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

set DOTFILES bin Wallpapers .gitconfig .spacemacs .tmux.conf 

for dotfile in $DOTFILES
    backup_dotfile $dotfile
    symlink_dotfile $dotfile
end

backup_dotfile .config
ln -s $DOTFILEDIR/config $HOMEDIR/.config

backup_dotfile .gitcredentials
echo '[user]
#name = $NAME
#email = $EMAIL' > $HOMEDIR/.gitcredentials

