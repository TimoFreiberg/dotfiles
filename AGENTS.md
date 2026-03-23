# Guidelines for my dotfiles repo

## Pi Extensions

Pi agent config is at `config/pi/agent`.
Extensions are in `config/pi/agent/extensions/`.
The `config` directory is symlinked to `~/.config`

## Version Control

After committing, the current change should be empty.
**Update the main bookmark** at the end: `jj bookmark set main -r @-`
