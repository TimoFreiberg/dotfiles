# Chezmoi migration plan

## Strategy: additive public source (first task)

This repository now contains an additive chezmoi source under `home/`; it does
not replace or relocate the canonical repository layout. `config/`, `agents/`,
`bin/`, `.profile`, `.zshenv`, `gitconfig.ini`, `global-gitignore`, and the
existing hidden skill paths remain where they are. No live home directory is
modified by this task, and runtime, bootstrap, update, and cutover work remains
deferred. Receiving or updating this repository revision is safe for an
unmigrated machine; applying it is intentionally refused while the
chezmoi destination `.config` is the legacy directory symlink.

The source root is selected by `.chezmoiroot` (`home`) and requires chezmoi
`2.72.2` or newer. Source entries are an explicit public allowlist. Ordinary
portable files are symlinks to absolute targets derived from
`.chezmoi.sourceDir`; this keeps the source layout valid when the checkout path
contains spaces and avoids relying on deployment-time relative-link depth.

The initial allowlist is:

- `.profile` and `.zshenv`, linked to the canonical root files.
- Fish config and the reviewed `fish_prompt.fish` function.
- jj config, tmux config, Ghostty config, and Zellij config.
- The Polytoken public skills directory.
- Selected Pi public links: two reviewed skills, one public agent definition,
  and two public extensions, under a real `.config/pi/agent` directory.
- Polytoken `AGENTS.md`, materialized as a regular private `0600` file. Its
  template uses chezmoi's source-relative `include` semantics to render the
  canonical `config/polytoken/AGENTS.md`; it does not duplicate the
  authoritative prose.

The following are deliberately not managed in this task: local identity
wrappers and Git/jj identity, `gitconfig.ini` and `global-gitignore`, secrets,
private runtime/provider configuration, `fish_variables`, app sessions,
authentication, caches, histories, generated overlays, Pi `roles.json`, whole
application directories, Claude deployment, and package or OS setup. The
macOS-only Karabiner path is excluded on non-Darwin systems. The existing
canonical files and symlink-backed agent and skill paths are preserved
unchanged.

`home/.chezmoi.toml.tmpl` uses an absolute `.chezmoi.sourceDir`, `mode =
"symlink"`, neutral `promptBoolOnce` initialization, and disables Git
`autoAdd`, `autoCommit`, and `autoPush`. Existing prompt data is retained by
chezmoi on re-init; no secret retrieval is present. The local chezmoi config,
persistent state, cache, destination, and XDG/HOME paths belong outside this
public source during rehearsal and cutover.

## Overall migration recommendation

Use chezmoi's symlink mode to deploy an explicit allowlist from `home/` while
keeping the canonical repository sources permanently at their current paths.
`config/`, `agents/`, `bin/`, `.profile`, `.zshenv`, Git wrappers, and hidden
skill paths are not moved or renamed. Templates in `home/` point to those
canonical sources; they do not become a second editable configuration tree.
Replace the whole-directory `~/.config` symlink with a real directory only as a
live-home cutover step. Keep private machine configuration outside the
checkout, retire the unused Claude Code setup, and leave SSH private keys with
the existing password manager.

This is a proposed migration, not an executed one. No secret file contents are
included in this plan. Implement in stages, with a disposable-home rehearsal
before changing the live home. The same repository revision must remain usable
with both the existing symlinked home and a migrated home.

## Current constraints

- `bootstrap.fish` links `~/.config` and `~/.claude` into the checkout. Ignored
  credentials, histories, caches, and machine settings can therefore live
  physically inside the public repository today. Git ignore rules are not a
  confidentiality boundary.
- Fish loads an ignored employer-specific override and
  `$HOME/.local/share/fish/secrets.fish`. The override was absent on the
  inspected machine; its contents and other machines' variants still need an
  owner-led inventory. Local fish functions are another existing extension
  point.
- `.zshenv` also parses that secrets file. It is not a general fish
  interpreter: changes to quoting, multiple flags, or multiline values can
  break zsh consumers.
- The secrets file has mode `0644`; review confirmed its existing
  `$HOME/.local/share/fish` parent is `0700`. Restrict the file to `0600` and
  retain the parent's `0700` mode without changing the path. This is fish's data
  directory, not a dedicated secrets directory.
- Git identity lives in a local `~/.gitconfig`; jj identity uses an ignored
  `conf.d/user.toml`. Pi's active role map is local; Zed merges tracked base
  settings with a local overlay.
- The inspected machine also has `~/.pi` linked directly into `config/pi/`;
  include it in the cutover and rollback inventory. Its agent runtime state
  needs preservation alongside `.config`. Keep `~/.config/pi/agent` a real
  directory with selected linked children, not a directory symlink into
  source: `pi-docker` mounts its resolved path read-write.
- Agent configuration has shared links into `agents/`. Polytoken's global
  `AGENTS.md` must remain a real file at its deployed location. Some hooks and
  shell paths explicitly depend on `$HOME/dotfiles`.
- The old bootstrap references `.tmux.conf`, which is not in the tracked
  inventory. Use the tracked `config/tmux/tmux.conf`; verify actual tmux
  discovery before retiring the old link.

## Ownership and privacy

| Information | Owner and storage | Migration decision |
| --- | --- | --- |
| Portable config, hooks, functions, shared skills | Public repository | Deploy selected files with chezmoi |
| OS and home directory | chezmoi built-in template data | Use `.chezmoi.os` and `.chezmoi.homeDir`, not literal usernames |
| Feature choices and private identity | Local chezmoi config, outside checkout | Local `[data]`, initialized with neutral prompts |
| Work hosts, paths, aliases and other identifying details | Local override outside checkout | Do not put them in public templates or examples |
| API secrets | Existing local secrets file initially | Preserve interface and tighten permissions |
| Optional password-manager-backed secrets | Existing manager as authority | Opt in during a second phase after selecting provider and access model |
| SSH private keys | Existing password manager or agent | Do not import, duplicate, or re-encrypt in this repo |
| Sessions, auth stores, memories, histories, caches | Applications or existing sync | Preserve locally; never recursively add |

`private_` controls destination permissions; it does not encrypt repository
content. `.chezmoiignore` controls deployment; it does not stop Git or jj from
tracking files. `.gitignore` controls tracking; it does not tell chezmoi which
source entries to deploy. Use a clean source subtree and a tracked-file
allowlist, not either ignore mechanism alone.

Do not commit private identifiers even when they are not credentials: employer
names, internal domains, usernames, vault or item names, host aliases, and
machine-specific paths can all disclose information. A neutral feature such as
`enableWorkTools` is acceptable in a public schema; its value and associated
private settings remain local.

## Source and deployment layout

The repository root remains the canonical source layout. `home/` contains only
chezmoi deployment entries and templates; it does not contain relocated copies
of canonical files. The relevant relationship is:

```text
$HOME/dotfiles/                  # permanent repository checkout
  config/                         # canonical shell and app configuration
  agents/                         # canonical shared agent assets
  bin/                            # canonical wrappers and scripts
  .profile, .zshenv               # canonical shell entrypoints
  gitconfig.ini, global-gitignore # canonical Git support files
  home/                           # additive chezmoi deployment source
    .chezmoiversion
    .chezmoi.toml.tmpl
    .chezmoiignore
    symlink_*.tmpl                # links to canonical files above
    dot_config/...                # selected deployment targets
```

Set local chezmoi `sourceDir` to `$HOME/dotfiles`; `.chezmoiroot` selects
`home/` as the deployment source inside that checkout. The actual local
configuration value needs an expanded absolute path, not an assumed shell
expansion of `$HOME` in TOML. Set `mode = "symlink"` in local chezmoi config.
Ordinary eligible deployment targets link to canonical repository files;
templated, encrypted, executable, and `private_` files are materialized.
Directory-wide linking is not how this mode works. Use a `private_` source
attribute for Polytoken's global instruction file so it is materialized as a
regular file. A disposable chezmoi v2.72.2 apply confirmed the current template
renders it with mode `0600`. Do not use symlink mode for app-written files unless
changes belong in public source; materialize those selectively or leave them
unmanaged. Disable chezmoi Git auto-add, auto-commit, and auto-push; continue
to use jj manually.

The local chezmoi configuration belongs at
`$HOME/.config/chezmoi/chezmoi.toml` when the live `.config` directory is
prepared. During rehearsal and cutover, use a private config outside the
checkout and any live `.config` symlink. Do not run an initial unqualified
`chezmoi init` against a live home.

Use public templates for structural variation only:

- OS-specific inclusion for macOS-only configuration such as Karabiner.
- Explicit feature flags rather than hostname or employer-name matching.
- Local Git/jj identity values serialized correctly for the destination format.
- Pi role selection and genuinely portable machine preferences.

Keep imperative or private machine setup in
`$HOME/.local/share/fish/machine.fish`, sourced conditionally at the same point
as the current override. This avoids relocating confidential work details into
templates. A separate local layer remains useful even with chezmoi; templates
should replace portable branching, not become a private-data database.

Create shared-asset links using chezmoi `symlink_*.tmpl` entries. With
`.chezmoiroot = home`, `.chezmoi.sourceDir` resolves to the `home/` deployment
source, so shared skills use targets such as
`{{ .chezmoi.sourceDir }}/../agents/skills`; use corresponding sibling paths
for extensions and agent definitions. These targets preserve the canonical
`agents/` files and hidden skill paths. Explicitly deploy shared files where
symlinks are unsupported. Do not copy existing relative link text blindly:
the deployment depth differs. The canonical `agents/AGENTS.md` remains at its
current path, while chezmoi deploys a regular file to
`~/.config/polytoken/AGENTS.md`. No coordinated manual update of other
canonical files or instructions is required for this additive source.

Retain `config/`, `agents/`, `bin/`, root shell files, Git wrappers, and hidden
skill paths at their existing paths permanently. Audit runtime dependencies,
particularly `gitconfig.ini`, its global-ignore path, and Zed's script-relative
merge inputs, without moving those sources. No runtime memory or local merge
output should be written back into the checkout after cutover.

Claude Code is retired, not migrated: after a private backup and owner
confirmation of any memories to retain, remove only the `~/.claude` symlink and
retire Claude-only tracked settings, hooks, and bootstrap steps. Do not create
`dot_claude`. Keep shared `agents/` skills, references, and instructions used
by Pi or Polytoken; check consumers before removing apparently Claude-specific
assets. Unneeded ignored Claude state must be removed from the checkout only
after backup verification, not left indefinitely beside public source.
Retirement inventory includes `claude/` settings, statusline, hooks,
`bin/claude-sandboxed`, the install entry in `bin/update`, fish's `cl`
abbreviation, Claude lint targets in `justfile`, and Claude instruction links
and table rows. Review ignore rules separately: retaining protective ignores
can prevent future accidental publication.

## Secrets and SSH

### Phase-one default: keep secrets local

Keep `$HOME/.local/share/fish/secrets.fish` unmanaged and do not render its
contents into chezmoi templates. Preserve fish and zsh behavior, including
noninteractive zsh consumers. Move any remaining ignored secret files out of
the checkout only after confirming which consumers use them. Add source-tree
tripwires for accidental local secret files, but do not treat them as a
substitute for keeping values elsewhere.

Do not automatically export more credentials than today. A later reduction to
command-scoped retrieval or `direnv` is worthwhile, but is separate from this
migration. Programs running as the user, including agents and child processes,
may access plaintext files or inherited environment variables; chezmoi is not
an isolation boundary.

### Optional second phase: password-manager integration

Select the actual password manager and CLI before implementing integration.
Prefer retrieving selected fields at apply time over storing encrypted copies of
material already synchronized elsewhere. Store private item references in local
template data, never inline in public templates. Authentication must be
operator-controlled; do not put tokens in command arguments, scripts, or source
files.

A rendered secret remains plaintext on disk. Use private parent directories and
`private_` files, and verify final modes. For fish and zsh compatibility, either
restrict and test the current shared file grammar or generate separately
escaped shell-specific files from one manager record. Do not assume Go template
quoting is fish-safe.

A locked or unavailable manager must produce a failed operation rather than
empty credentials. Rehearse failure before touching live files. Chezmoi apply
is not a transaction across all targets; an earlier unrelated target may
already have changed when a later retrieval fails. Separate secret refresh from
ordinary configuration deployment and retain the last usable local file with a
tested recovery path.

Do not introduce age or GPG encryption by default: it adds a decryption-key
bootstrap and another secret lifecycle without an identified need. Reconsider
encrypted files only for private artifacts not already managed elsewhere,
accepting that public ciphertext and filenames still expose metadata and persist
in history.

Leave SSH keys and agent integration as they are. Optionally manage generic SSH
client defaults later, preserving a local include for private host mappings. Do
not ingest `~/.ssh`, `known_hosts`, control sockets, or authorized keys
wholesale. Test any later SSH config change in a second connection before
closing a working session.

## Delivery sequence

### 1. Private inventory and rollback preparation

1. Inventory tracked files separately from ignored runtime state on each
   machine. Read private content only locally, with the owner's involvement;
   record categories and consumers in public notes, not values or identifying
   filenames.
2. Audit existing tracked content and history for credentials and identifying
   data using a scanner configured not to print values. Review findings
   privately. Explicitly review the already-tracked employer-specific fish
   filename and Pi's work role-map/provider metadata before carrying them
   forward. Rotate or revoke exposed credentials if found; historical
   identifying details require a separate cleanup decision. This migration
   cannot undo publication.
3. Stop configuration writers and agent sessions for the eventual cutover.
   Back up the dereferenced contents of `.config` and `.claude`, relevant home
   files, local identities and overrides, plus original link targets and modes,
   to private storage outside the checkout. Include ignored state and external
   memory locations; do not assume a repo commit is a backup.
4. Record a local restore manifest and verify it against the backup. Preserve
   external symlinks deliberately, without recursively traversing arbitrary
   trees. Do not publish the manifest or backup.

### 2. Build additive deployment source

1. Keep the canonical repository layout unchanged. Add `.chezmoiroot`, a
   `.chezmoiversion` requiring the verified version (initially `2.72.2`), and
   the `home/` deployment entries from an explicit public allowlist. Never use
   `chezmoi add ~/.config`, `chezmoi add ~/.claude`, `add ~`, or an
   indiscriminate recursive copy of current home or checkout directories.
2. Point deployment templates at the permanent canonical files. Do not create
   relocated copies or require coordinated edits to `config/`, `agents/`,
   `bin/`, root shell files, Git wrappers, or hidden skill paths.
3. Separate portable config from local identities and work overrides. Init
   prompts must preserve existing local choices on re-init, use neutral
   defaults, and avoid requesting secrets. Protect local config permissions.
4. Add deployment entries file by file: shell entrypoints, fish functions and
   config, Git/jj shared defaults, terminal/editor config, then selected agent
   files and links. Preserve executable bits for scripts. No package
   installation or OS-setting hooks in the initial apply.
5. Keep Zed's current base/local merge ownership: deploy the base and helper
   together, run the merge at the destination, and leave local input and
   generated `settings.json` unmanaged. Do not give both chezmoi and the merge
   helper ownership of the generated file.
6. Keep Pi's local active-role selection unless the owner opts into a template
   backed by a local choice. Leave Polytoken's local runtime/provider
   configuration and credentials unmanaged.
7. Treat bootstrap and update changes as later retirement or cutover work, not
   as prerequisites for this additive source. The same revision must work for
   an unmigrated fixture and a migrated fixture; do not run a bootstrap mode
   that assumes files were moved.

### 3. Rehearse in isolation

Use a disposable destination and dummy private data. Explicitly override
source, destination, config, persistent-state, and cache paths. Use an isolated
HOME/XDG environment where practical. `--destination` alone is not a sandbox:
templates, scripts, subprocesses, and external lookups can still touch the real
machine. Disable all scripts, externals, and real secret retrieval during the
first rehearsal; audit before enabling anything else.

Test a fresh destination and a fixture reproducing the existing directory-
symlink layout, with fake ignored app state and fake local overrides. Do not use
real secrets in tests or CI. Render both enabled and disabled feature variants;
use actual macOS and Linux for platform acceptance, not only a simulated
template OS. Verify that the same revision works with both the unmigrated
fixture and the migrated fixture.

On dummy data, `chezmoi diff` and dry-run are useful. On real data, diff,
verbose or debug output, `cat`, `dump`, template evaluation, and config dumps
may expose values. Do not send those outputs to agents, CI, logs, or public
review. `--skip-secrets` is not a general redactor for arbitrary private local
data. Review real private targets only in a trusted local session.

### 4. Cut over one machine

1. Keep source changes reversible and have a working shell open. With writers
   stopped and backups verified, stage a real replacement `.config` directory
   privately outside the checkout, preserving existing unmanaged state and
   resolving old relative links deliberately. Preserve wanted Claude state in a
   private archive; do not stage a replacement `.claude`.
2. Remove only the recorded `.config` and `.claude` symlinks after verifying
   their targets; do not recursively delete linked trees. Install the staged
   real `.config`, including preserved Pi auth and session state. Replace the
   recorded `~/.pi` symlink with one pointing to `$HOME/.config/pi`. Keep the
   canonical repository layout and the same revision in place. Install local
   chezmoi config under the real `.config` and confirm it does not resolve
   inside the checkout. Keep applications stopped until the apply repairs
   remaining staged configuration links.
3. Apply reviewed target groups incrementally with conflict checking; do not
   use `--force`. Start with low-risk non-secret configuration. Preserve all
   unowned runtime files. Do not use `exact_` directories or `remove_` cleanup
   rules for mixed application state.
4. Move the work override to the neutral local location, preserve local
   functions and identities, and tighten secret-file permissions. Keep the
   secret interface unchanged in this phase.
5. Verify links, applications, shell behavior, and private state before
   deleting old duplicates from the checkout. Remove old ignored private or
   runtime copies only against the verified backup and restore manifest, with
   owner approval. Keep backups through a normal usage cycle.
6. Repeat on other machines only after the first machine passes acceptance.
   Machine-specific choices are local initialization, not source edits or
   hostname-specific commits. The same revision must work before and after
   cutover.

### 5. Establish the new workflow

Eligible public files can still be edited through their live symlinks, but
follow this repo's convention of editing the canonical source. For templates
and materialized files, edit source or use `chezmoi edit`, then apply. Inspect
safe diffs and commit explicit paths with jj. App-written materialized
destination changes require deliberate reconciliation, not an automatic
recursive `re-add`. Use jj to fetch and integrate repository changes, followed
by chezmoi apply; do not use chezmoi's Git update or commit automation against
the jj working copy. Do not push automatically.

## Disposable verification acceptance

The first-task review must use a disposable fixture with HOME, XDG
config/data, cache, persistent state, source, destination, and config paths
isolated from the live machine. Test data must be dummy non-secret values; no
secret retrieval, scripts, externals, or real application state is permitted.
Automated test files and fixture harnesses are temporary review artifacts only:
keep them outside this repository, retain them through verification, and remove
them before migration completion. No test scaffolding is to remain tracked or
installed.

The fixture acceptance checks are:

- Fresh apply creates only the explicit managed allowlist.
- Every managed link resolves to the expected canonical absolute target.
- Polytoken instructions are regular, private, and rendered from the canonical
  file.
- Unmanaged dummy auth, session, overlay, and runtime files survive apply.
- A second apply is idempotent and does not alter unmanaged state.
- Enabled and disabled OS rendering is checked where feasible, including the
  non-Darwin Karabiner exclusion.
- Paths containing spaces work.
- The canonical repository source layout is unchanged, and the same revision works with both the unmigrated and migrated fixtures.
- Source auditing finds no secret retrieval or copied secret content.

Durable migration command safety checks remain required even though test files
are temporary: every later rehearsal or cutover command must use explicit
source, destination, config, cache, persistent-state, and HOME/XDG paths,
disable scripts and externals, avoid unqualified init, and never run against
live HOME.

## Acceptance checks

| Check | Required result |
| --- | --- |
| Source privacy | Only allowlisted config and templates are tracked; no rendered identity, private work details, credentials, backups, or runtime state |
| Filesystem boundary | `.config` is a real directory; retired `.claude` link is absent; private local config/state does not resolve inside `$HOME/dotfiles`; eligible public files remain source-linked |
| Local state survival | Fake fixture and live manifest confirm unmanaged auth/session/history/memory/overlay files survive |
| Machine variation | Both feature states render; missing overrides are harmless; local choices survive re-init |
| Shell compatibility | `fish -n`, `zsh -n`, and fresh fish/zsh sessions pass; dummy secret values with spaces and quoting are checked without printing real values |
| Modes and links | Secrets are `0600`, existing fish data parent remains `0700`; executable scripts run; all migrated shared links resolve; Polytoken instructions are regular files |
| Identity and paths | Git/jj retain local identity; source and home paths work under a different username and with spaces; no literal machine home paths |
| Applications | tmux, editors, Pi/Polytoken instructions, skills and hooks, `pi-docker`, local role selection, and Zed merging work; `~/.pi` resolves into real `.config/pi`; private runtime state survives |
| Compatibility window | The same revision works with both an unmigrated fixture using the existing symlink layout and a migrated fixture using a real `.config` directory; neither runs a bootstrap mode that assumes moved files |
| Idempotence | Second apply changes nothing for owned files and leaves unmanaged fixture files unchanged |
| Platforms | macOS and Linux passes, with macOS-only files excluded on Linux |
| Failure handling | Missing override works; unavailable optional secret backend cannot replace credentials with empty output; interrupted cutover is recoverable |
| Rollback | Fixture restoration reproduces original symlinks, canonical repository sources, private state, file modes, and shell startup |

Rollback requires both filesystem and repository restoration. Stop writers,
preserve any new state created since cutover, and restore directory contents,
local files, symlinks, and canonical checkout state from the private backup and
manifest. The same repository revision remains valid for rollback; no source
move or revision pin is required. A jj undo alone does not restore ignored files
or the home directory. Never remove newly generated state without first
preserving it.

## Deferred decisions

The first phase needs no password-manager integration choice and does not
change SSH key handling. Before phase two, the owner chooses the provider,
which secrets should be materialized, and whether disk plaintext or
command-scoped retrieval is acceptable. Inventory each machine before deciding
which portions of its private shell override can safely become public feature
templates.

## References

- [Symlink mode and its limitations](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)
- [Initialization and local data](https://www.chezmoi.io/user-guide/setup/)
- [Source directory attributes](https://www.chezmoi.io/reference/source-state-attributes/)
- [`.chezmoiroot`](https://www.chezmoi.io/reference/special-files/chezmoiroot/)
- [Machine differences](https://www.chezmoi.io/user-guide/manage-machine-to-machine-differences/)
- [Password managers](https://www.chezmoi.io/user-guide/password-managers/)
- [Encryption](https://www.chezmoi.io/user-guide/encryption/)
- [chezmoi configuration](https://www.chezmoi.io/reference/configuration-file/)

Local evidence: `bootstrap.fish`, `.profile`, `.zshenv`, `config/fish/config.fish`,
Git/jj configuration, per-application ignore rules,
`config/zed/merge-settings.sh`, agent link metadata, and `AGENTS.md`. Private
contents and a full historical privacy audit were outside this investigation.
