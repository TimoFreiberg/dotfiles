#!/usr/bin/env fish

cd (dirname (status --current-filename))

set DOTFILEDIR (pwd)
set HOMEDIR $HOME

# Never run the legacy mutating bootstrap against a migrated home.
set config_path "$HOMEDIR/.config"
if test -d "$config_path"; and not test -L "$config_path"
    echo "Refusing legacy bootstrap: ~/.config is already a real directory."
    echo "Use bin/dotfiles-migrate compare, then manage the home with chezmoi."
    exit 2
end
if test -L "$config_path"; and not test (readlink "$config_path") = "$DOTFILEDIR/config"
    echo "Refusing legacy bootstrap: ~/.config has an unexpected symlink target."
    exit 2
end

set tmpdir (mktemp -d)

function backup_dotfile
    set f $HOMEDIR/$argv
    if test -e $f
        echo "moving $f to $tmpdir/$argv"
        mv $f $tmpdir/$argv
    end
end

function symlink_dotfile
    symlink_dotfile_as $argv[1] $argv[1]
end

function symlink_dotfile_as
    set src $argv[1]
    set dst $argv[2]
    if test -L $HOMEDIR/$dst
        return
    end
    ln -s $DOTFILEDIR/$src $HOMEDIR/$dst
end

backup_dotfile .tmux.conf
symlink_dotfile .tmux.conf

backup_dotfile .zshenv
symlink_dotfile .zshenv

backup_dotfile .profile
symlink_dotfile .profile

backup_dotfile .config
symlink_dotfile_as config .config

backup_dotfile .gitconfig
echo "[user]
    name =
    email =

[include]
    path=$DOTFILEDIR/gitconfig.ini
" > ~/.gitconfig

echo "Add name and email to ~/.gitconfig"

echo "Add config/jj/conf.d/user.toml as follows:
[user]
name = 
email = 
"

# mac only
if test (uname) = "Darwin"
  defaults write com.apple.dock autohide-delay -float 0 && defaults write com.apple.dock autohide-time-modifier -float 0.4 && killall Dock
  defaults write com.apple.Preview ApplePersistenceIgnoreState YES
end
