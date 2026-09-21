# Linux/MacOS Installation

## Existing machines

Do not run `bootstrap.fish` on a migrated home. It now refuses a real
`~/.config`, but it still performs the old symlink setup on an unmigrated home.

The migration is manual and never runs from shell startup:

```sh
bin/dotfiles-migrate preflight --dry-run
bin/dotfiles-migrate prepare --writers-stopped --colima-stopped
bin/dotfiles-migrate cutover --writers-stopped --colima-stopped --confirm-cutover
bin/dotfiles-migrate compare
```

`prepare` stores a mode/link-target/content snapshot and verified sparse-aware
backup outside this checkout. Unix-domain socket entries are excluded from
copies, snapshots, and comparisons; the originals are left untouched. Writers
must still be stopped, and FIFOs/devices remain unsupported.
`cutover` takes a fresh snapshot immediately
before swapping `.config`; it refuses any legacy source, `.pi`, `.claude`, home
file, or secrets-interface change since `prepare`. Stop Polytoken, Pi, chezmoi,
and Colima before `prepare` and `cutover`; the helper refuses active writers and
never kills them. Relative links that remain inside `.config` are rewritten for
the new depth, public checkout links become canonical absolute links, and
private or unknown checkout links are refused. The helper does not run chezmoi
or claim that chezmoi has applied configuration.

`compare` is the pre-chezmoi gate: it checks that the migrated real `.config`
copy and translated links match the cutover snapshot. It does not validate
chezmoi's later public links or materialized files.

Keep private state until `compare` passes and an owner approves cleanup. An
interrupted cutover is recorded before the swap and refuses rerun; after
stopping writers, use `bin/dotfiles-migrate rollback --writers-stopped
--confirm-rollback` to move the new real `.config` into private recovery and
restore only recorded old links. If the interruption happened before the swap,
rollback verifies that the complete legacy snapshot is unchanged and returns the
manifest to `prepared` for retry. Rollback never deletes new state. Use `--state
PATH` only for a new, dedicated user-owned 0700 directory outside the
repository. The helper prints categories and counts only, never file contents.

For a new or intentionally legacy home, run `bootstrap.fish` from this
checkout. It is not a migration tool and never applies chezmoi. It preserves
legacy `~/.config` and shared agent paths; Claude Code-specific setup is retired.

After `cutover` and a passing `compare`, initialize and apply the additive
chezmoi source from the migrated home:

```sh
chezmoi init --source "$HOME/dotfiles"
chezmoi apply --source "$HOME/dotfiles"
```

Do not use `--force`; review only safe public targets before applying, and do
not publish private `chezmoi diff` output. The helper comparison above is the
copy/link-equivalence check before apply, not a check of chezmoi's intentional
post-apply differences: ordinary public files may remain symlinks while
`private_` or templated files are materialized. Keep the verified private backup
and manifest through a normal usage cycle. After owner approval, clean up any
pending ignored Claude runtime state from the checkout separately; do not
remove a live `~/.claude` link here—the helper handles that during cutover.
Fish now prefers `$HOME/.local/share/fish/machine.fish`, falling back to the
legacy work override only when the new file is absent. The helper does not
relocate that override: after backup, move it to the new local path on machines
that have one, keep it private, and verify a fresh fish session before removing
its old copy. Do not overwrite an existing `machine.fish` without merging it
locally.

## MacOS notes
- `brew install scroll-reverser maccy` 

# Windows notes

Key tools

- [Fan Control](https://getfancontrol.com/) for setting up fans
  Last config is in "Dropbox/Documents/Fancontrol Config - userConfig.json"
- US International (no dead keys) keyboard layout: Use [Microsoft Keyboard Layout Creator](https://www.microsoft.com/en-us/download/details.aspx?id=102134) to import the layout file, create an installer/dll from it and run that.
- undervolting with [MSI Afterburner](https://www.msi.com/Landing/afterburner/graphics-cards) and [HWiNFO](https://www.hwinfo.com/)
  - Curve so far: default curve pulled up to set 975mV to 2775 MHz, flat after that. Got at least one game crash so use a less aggressive one next time
