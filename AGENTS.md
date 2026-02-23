# Guidelines for my dotfiles repo

## Pi Extensions

Pi agent config is at `config/pi/agent`.
Extensions are in `config/pi/agent/extensions/`.
The `config` directory is symlinked to `~/.config`

## Version Control

After committing new `jj` changes, the current change should be empty (`jj commit` prints "Working copy ... now at: ... (empty) (no description set)").
**Update the main bookmark** at the end: `jj bookmark set main -r @-`
