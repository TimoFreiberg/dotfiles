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

backup_dotfile .tmux.conf
symlink_dotfile .tmux.conf

backup_dotfile .zshenv
symlink_dotfile .zshenv

backup_dotfile .profile
symlink_dotfile .profile

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

backup_dotfile .claude
ln -s $DOTFILEDIR/claude $HOMEDIR/.claude

# mac only
if test (uname) = "Darwin"
  defaults write com.apple.dock autohide-delay -float 0 && defaults write com.apple.dock autohide-time-modifier -float 0.4 && killall Dock
  defaults write com.apple.Preview ApplePersistenceIgnoreState YES
end

echo "symlink $(pwd)/claude/memories to a repo if you want to back it up"
