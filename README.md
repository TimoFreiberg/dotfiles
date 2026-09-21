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
backup outside this checkout. `cutover` takes a fresh snapshot immediately
before swapping `.config`; it refuses any legacy source, `.pi`, `.claude`, home
file, or secrets-interface change since `prepare`. Stop Polytoken, Pi, Claude,
chezmoi, and Colima before `prepare` and `cutover`; the helper refuses active
writers and never kills them. Relative links that remain inside `.config` are
rewritten for the new depth, public checkout links become canonical absolute
links, and private or unknown checkout links are refused. The helper does not
run chezmoi or claim that chezmoi has applied configuration.

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
checkout. It is not a migration tool and never applies chezmoi.

## MacOS notes
- `brew install scroll-reverser maccy` 

# Windows notes

Key tools

- [Fan Control](https://getfancontrol.com/) for setting up fans
  Last config is in "Dropbox/Documents/Fancontrol Config - userConfig.json"
- US International (no dead keys) keyboard layout: Use [Microsoft Keyboard Layout Creator](https://www.microsoft.com/en-us/download/details.aspx?id=102134) to import the layout file, create an installer/dll from it and run that.
- undervolting with [MSI Afterburner](https://www.msi.com/Landing/afterburner/graphics-cards) and [HWiNFO](https://www.hwinfo.com/)
  - Curve so far: default curve pulled up to set 975mV to 2775 MHz, flat after that. Got at least one game crash so use a less aggressive one next time
