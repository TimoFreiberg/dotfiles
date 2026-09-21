# Chezmoi migration plan

## Recommendation

Use chezmoi's symlink mode to keep eligible public configuration files linked to this repository, with templates and private files materialized separately. Keep the public repository at `$HOME/dotfiles`, put chezmoi source state in a dedicated `home/` subtree, and replace the whole-directory `~/.config` symlink with a real directory. Manage an explicit allowlist, not entire application directories. Keep private machine configuration outside the checkout, retire the unused Claude Code setup, and leave SSH private keys with the existing password manager.

This is a proposed migration, not an executed one. Investigation used tracked configuration, selected filesystem metadata, and chezmoi v2.72.2 CLI help. No secret file contents were read. Implement in stages, with a disposable-home rehearsal before changing the live home.

## Current constraints

- `bootstrap.fish` links `~/.config` and `~/.claude` into the checkout. Ignored credentials, histories, caches, and machine settings can therefore live physically inside the public repository today. Git ignore rules are not a confidentiality boundary.
- Fish loads an ignored employer-specific override and `$HOME/.local/share/fish/secrets.fish`. The override was absent on the inspected machine; its contents and other machines' variants still need an owner-led inventory. Local fish functions are another existing extension point.
- `.zshenv` also parses that secrets file. It is not a general fish interpreter: changes to quoting, multiple flags, or multiline values can break zsh consumers.
- The secrets file has mode `0644`; review confirmed its existing `$HOME/.local/share/fish` parent is `0700`. Restrict the file to `0600` and retain the parent's `0700` mode without changing the path. This is fish's data directory, not a dedicated secrets directory.
- Git identity lives in a local `~/.gitconfig`; jj identity uses an ignored `conf.d/user.toml`. Pi's active role map is local; Zed merges tracked base settings with a local overlay.
- The inspected machine also has `~/.pi` linked directly into `config/pi/`; include it in the cutover and rollback inventory. Its agent runtime state needs preservation alongside `.config`. Keep `~/.config/pi/agent` a real directory with selected linked children, not a directory symlink into source: `pi-docker` mounts its resolved path read-write.
- Agent configuration has shared links into `agents/`. Polytoken's global `AGENTS.md` must remain a real file at its deployed location. Some hooks and shell paths explicitly depend on `$HOME/dotfiles`.
- The old bootstrap references `.tmux.conf`, which is not in the tracked inventory. Use the tracked `config/tmux/tmux.conf`; verify actual tmux discovery before retiring the old link.

## Ownership and privacy

| Information | Owner and storage | Migration decision |
| --- | --- | --- |
| Portable config, hooks, functions, shared skills | Public repository | Deploy selected files with chezmoi |
| OS and home directory | chezmoi built-in template data | Use `.chezmoi.os` and `.chezmoi.homeDir`, not literal usernames |
| Feature choices and private identity | Local chezmoi config, outside checkout | Local `[data]`, initialized with neutral prompts |
| Work hosts, paths, aliases and other identifying details | Local override outside checkout | Do not put them in public templates or examples |
| API secrets | Existing local secrets file initially | Preserve interface and tighten permissions |
| Optional password-manager-backed secrets | Existing manager as authority | Opt-in second phase after selecting provider and access model |
| SSH private keys | Existing password manager / agent | Do not import, duplicate, or re-encrypt in this repo |
| Sessions, auth stores, memories, histories, caches | Applications or existing sync | Preserve locally; never recursively add |

`private_` controls destination permissions; it does not encrypt repository content. `.chezmoiignore` controls deployment; it does not stop Git/jj from tracking files. `.gitignore` controls tracking; it does not tell chezmoi which source entries to deploy. Use a clean source subtree and a tracked-file allowlist, not either ignore mechanism alone.

Do not commit private identifiers even when they are not credentials: employer names, internal domains, usernames, vault/item names, host aliases, and machine-specific paths can all disclose information. A neutral feature such as `enableWorkTools` is acceptable in a public schema; its value and associated private settings remain local.

## Proposed layout

Selected paths are shown; existing repository tooling and other retained files are omitted.

```text
$HOME/dotfiles/
  .chezmoiroot                 # contains: home
  home/
    .chezmoiversion            # initially 2.72.2
    .chezmoi.toml.tmpl         # neutral initialization prompts
    .chezmoiignore            # conditional OS/feature exclusions
    dot_profile
    dot_zshenv
    dot_config/
      fish/config.fish        # keep source-linked; no template needed yet
      fish/functions/...
      jj/config.toml
      polytoken/private_AGENTS.md # materialized regular file
      ...                     # only reviewed app configuration
  agents/...                  # shared public assets stay repo-native
  bin/...                     # retain existing PATH contract
  AGENTS.md
  README.md
  CHEZMOI-MIGRATION.md
```

Set local chezmoi `sourceDir` to `$HOME/dotfiles`; `.chezmoiroot` selects `home/` inside it. The actual local configuration value needs an expanded absolute path, not an assumed shell expansion of `$HOME` in TOML. Set `mode = "symlink"` in local chezmoi config. Ordinary eligible files link back to source; templated, encrypted, executable and `private_` files are materialized. Directory-wide linking is not how this mode works. Use a `private_` source attribute for Polytoken's global instruction file so it is materialized as a regular file, as confirmed by the reviewer's disposable v2.72.2 fixture. Do not use symlink mode for app-written files unless changes belong in public source; materialize those selectively or leave them unmanaged. Disable chezmoi Git auto-add/commit/push; continue to use jj manually.

The local chezmoi configuration belongs at `$HOME/.config/chezmoi/chezmoi.toml` after `.config` becomes a real directory. During rehearsal and cutover, use a private config outside both the checkout and the old symlinked `.config`. Do not run an initial unqualified `chezmoi init` while `.config` still points into the public checkout.

Use public templates for structural variation only:

- OS-specific inclusion for macOS-only configuration such as Karabiner.
- Explicit feature flags rather than hostname or employer-name matching.
- Local Git/jj identity values serialized correctly for the destination format.
- Pi role selection and genuinely portable machine preferences.

Keep imperative or private machine setup in `$HOME/.local/share/fish/machine.fish`, sourced conditionally at the same point as the current override. This avoids relocating confidential work details into templates. A separate local layer remains useful even with chezmoi; templates should replace portable branching, not become a private-data database.

Create shared-asset links using chezmoi `symlink_*.tmpl` entries. With `.chezmoiroot = home`, the template variable `.chezmoi.sourceDir` resolves to `$HOME/dotfiles/home`, not the repository root. Shared skills therefore need a target such as `{{ .chezmoi.sourceDir }}/../agents/skills`; use the corresponding sibling path for extensions and agent definitions. Explicitly deploy shared files where symlinks are unsupported. Do not copy existing relative link text blindly: the deployed directory depth differs. Keep `agents/AGENTS.md` pointing at the canonical source file after it moves, while deploying a regular file to `~/.config/polytoken/AGENTS.md`. Update project instructions and all affected references together.

Retain `agents/` and `bin/` at their existing paths. Audit remaining source-layout dependencies, particularly `gitconfig.ini`, its global-ignore path, and Zed's script-relative merge inputs. No runtime memory or local merge output should be written back into the checkout after cutover.

Claude Code is retired, not migrated: after a private backup and owner confirmation of any memories to retain, remove only the `~/.claude` symlink and retire Claude-only tracked settings/hooks and bootstrap steps. Do not create `dot_claude`. Keep shared `agents/` skills, references and instructions used by Pi or Polytoken; check consumers before removing apparently Claude-specific assets. Unneeded ignored Claude state must be removed from the checkout only after backup verification, not left indefinitely beside public source. Retirement inventory includes `claude/` settings/statusline/hooks, `bin/claude-sandboxed`, the install entry in `bin/update`, fish's `cl` abbreviation, Claude lint targets in `justfile`, and Claude instruction links/table rows. Review ignore rules separately: retaining protective ignores can prevent future accidental publication.

## Secrets and SSH

### Phase-one default: keep secrets local

Keep `$HOME/.local/share/fish/secrets.fish` unmanaged and do not render its contents into chezmoi templates. Preserve fish and zsh behavior, including noninteractive zsh consumers. Move any remaining ignored secret files out of the checkout only after confirming which consumers use them. Add source-tree tripwires for accidental local secret files, but do not treat them as a substitute for keeping values elsewhere.

Do not automatically export more credentials than today. A later reduction to command-scoped retrieval or `direnv` is worthwhile, but is separate from this migration. Programs running as the user, including agents and child processes, may access plaintext files or inherited environment variables; chezmoi is not an isolation boundary.

### Optional second phase: password-manager integration

Select the actual password manager and CLI before implementing integration. Prefer retrieving selected fields at apply time over storing encrypted copies of material already synchronized elsewhere. Store private item references in local template data, never inline in public templates. Authentication must be operator-controlled; do not put tokens in command arguments, scripts, or source files.

A rendered secret remains plaintext on disk. Use private parent directories and `private_` files, and verify final modes. For fish/zsh compatibility, either restrict and test the current shared file grammar or generate separately escaped shell-specific files from one manager record. Do not assume Go template quoting is fish-safe.

A locked or unavailable manager must produce a failed operation rather than empty credentials. Rehearse failure before touching live files. Chezmoi apply is not a transaction across all targets; an earlier unrelated target may already have changed when a later retrieval fails. Separate secret refresh from ordinary configuration deployment and retain the last usable local file with a tested recovery path.

Do not introduce age/GPG encryption by default: it adds a decryption-key bootstrap and another secret lifecycle without an identified need. Reconsider encrypted files only for private artifacts not already managed elsewhere, accepting that public ciphertext and filenames still expose metadata and persist in history.

Leave SSH keys and agent integration as they are. Optionally manage generic SSH client defaults later, preserving a local include for private host mappings. Do not ingest `~/.ssh`, `known_hosts`, control sockets, or authorized keys wholesale. Test any later SSH config change in a second connection before closing a working session.

## Delivery sequence

### 1. Private inventory and rollback preparation

1. Inventory tracked files separately from ignored runtime state on each machine. Read private content only locally, with the owner's involvement; record categories and consumers in public notes, not values or identifying filenames.
2. Audit existing tracked content and history for credentials and identifying data using a scanner configured not to print values. Review findings privately. Explicitly review the already-tracked employer-specific fish filename and Pi's work role-map/provider metadata before carrying them forward. Rotate/revoke exposed credentials if found; historical identifying details require a separate cleanup decision. This migration cannot undo publication.
3. Stop configuration writers and agent sessions for the eventual cutover. Back up the dereferenced contents of `.config` and `.claude`, relevant home files, local identities and overrides, plus original link targets and modes, to private storage outside the checkout. Include ignored state and external memory locations; do not assume a repo commit is a backup.
4. Record a local restore manifest and verify it against the backup. Preserve external symlinks deliberately, without recursively traversing arbitrary trees. Do not publish the manifest or backup.

### 2. Build clean source state

**Transition rule:** before moving tracked paths, record the old revision in each machine's private restore manifest and pin every unmigrated machine to that revision. Fetching is safe; updating its working copy to the new layout is not. Disable unattended working-copy updates during the transition. Build and rehearse in an isolated checkout so the first machine's live directory links still see the old layout. Switch the production checkout revision only inside the stopped-writers cutover, after staging and backing up old configuration. Migrate each remaining machine through the same procedure; do not run the old bootstrap against the new layout. Keep the old revision available until all machines have migrated. This avoids maintaining two editable configuration trees.

1. Add `.chezmoiroot`, a `.chezmoiversion` requiring the verified version (initially `2.72.2`), and the `home/` tree from an explicit list of tracked files. Never use `chezmoi add ~/.config`, `chezmoi add ~/.claude`, `add ~`, or an indiscriminate recursive copy of the current checkout directories.
2. Separate portable config from local identities and work overrides. Init prompts must preserve existing local choices on re-init, use neutral defaults, and avoid requesting secrets. Protect local config permissions.
3. Port file-by-file: shell entrypoints, fish functions/config, Git/jj shared defaults, terminal/editor config, then agent files and links. Preserve executable bits for scripts. No package installation or OS-setting hooks in the initial apply.
4. Keep Zed's current base/local merge ownership initially: deploy the base and helper together, run the merge at the destination, and leave local input and generated `settings.json` unmanaged. Do not give both chezmoi and the merge helper ownership of the generated file.
5. Keep Pi's local active-role selection unless the owner opts into a template backed by a local choice. Leave Polytoken's local runtime/provider configuration and credentials unmanaged.
6. Replace bootstrap documentation and adjust lint paths, shared instruction links, and code references for the source-layout move. Do not run the old bootstrap after cutover.

### 3. Rehearse in isolation

Use a disposable destination and dummy private data. Explicitly override source, destination, config, persistent-state and cache paths. Use an isolated HOME/XDG environment where practical. `--destination` alone is not a sandbox: templates, scripts, subprocesses and external lookups can still touch the real machine. Disable all scripts, externals and real secret retrieval during the first rehearsal; audit before enabling anything else.

Test a fresh destination and a fixture reproducing the old directory-symlink layout, with fake ignored app state and fake local overrides. Do not use real secrets in tests or CI. Render both enabled and disabled feature variants; use actual macOS and Linux for platform acceptance, not only a simulated template OS.

On dummy data, `chezmoi diff` and dry-run are useful. On real data, diff, verbose/debug output, `cat`, `dump`, template evaluation and config dumps may expose values. Do not send those outputs to agents, CI, logs, or public review. `--skip-secrets` is not a general redactor for arbitrary private local data. Review real private targets only in a trusted local session.

### 4. Cut over one machine

1. Keep source changes reversible and have a working shell open. With writers stopped and backups verified, stage a real replacement `.config` directory privately outside the checkout, preserving existing unmanaged state and resolving old relative links deliberately. Preserve wanted Claude state in a private archive; do not stage a replacement `.claude`.
2. Remove only the recorded `.config` and `.claude` symlinks after verifying their targets; do not recursively delete linked trees. Install the staged real `.config`, including preserved Pi auth/session state. Replace the recorded `~/.pi` symlink with one pointing to `$HOME/.config/pi`. With the old live links detached and state preserved, switch `$HOME/dotfiles` to the migration revision. Install local chezmoi config under the real `.config` and confirm it no longer resolves inside the checkout. Keep applications stopped until the apply repairs remaining staged configuration links.
3. Apply reviewed target groups incrementally with conflict checking; do not use `--force`. Start with low-risk non-secret configuration. Preserve all unowned runtime files. Do not use `exact_` directories or `remove_` cleanup rules for mixed application state.
4. Move the work override to the neutral local location, preserve local functions and identities, and tighten secret-file permissions. Keep the secret interface unchanged in this phase.
5. Verify links, applications, shell behavior and private state before deleting old duplicates from the checkout. Remove old ignored private/runtime copies only against the verified backup and restore manifest, with owner approval. Keep backups through a normal usage cycle.
6. Repeat on other machines only after the first machine passes acceptance. Machine-specific choices are local initialization, not source edits or hostname-specific commits.

### 5. Establish the new workflow

Eligible public files can still be edited through their live symlinks, but follow this repo's convention of editing the canonical source. For templates and materialized files, edit source or use `chezmoi edit`, then apply. Inspect safe diffs and commit explicit paths with jj. App-written materialized destination changes require deliberate reconciliation, not an automatic recursive `re-add`. Use jj to fetch and integrate repository changes, followed by chezmoi apply; do not use chezmoi's Git update/commit automation against the jj working copy. Do not push automatically.

## Acceptance checks

| Check | Required result |
| --- | --- |
| Source privacy | Only allowlisted config and templates are tracked; no rendered identity, private work details, credentials, backups or runtime state |
| Filesystem boundary | `.config` is a real directory; retired `.claude` link is absent; private local config/state does not resolve inside `$HOME/dotfiles`; eligible public files remain source-linked |
| Local state survival | Fake fixture and live manifest confirm unmanaged auth/session/history/memory/overlay files survive |
| Machine variation | Both feature states render; missing overrides are harmless; local choices survive re-init |
| Shell compatibility | `fish -n`, `zsh -n`, and fresh fish/zsh sessions pass; dummy secret values with spaces and quoting are checked without printing real values |
| Modes and links | Secrets are `0600`, existing fish data parent remains `0700`; executable scripts run; all migrated shared links resolve; Polytoken instructions are regular files |
| Identity and paths | Git/jj retain local identity; source and home paths work under a different username and with spaces; no literal machine home paths |
| Applications | tmux, editors, Pi/Polytoken instructions/skills/hooks, `pi-docker`, local role selection and Zed merging work; `~/.pi` resolves into real `.config/pi`; private runtime state survives |
| Transition window | An unmigrated fixture remains functional on the pinned old revision while a second fixture uses the new layout; neither runs the wrong bootstrap |
| Idempotence | Second apply changes nothing for owned files and leaves unmanaged fixture files unchanged |
| Platforms | macOS and Linux passes, with macOS-only files excluded on Linux |
| Failure handling | Missing override works; unavailable optional secret backend cannot replace credentials with empty output; interrupted cutover is recoverable |
| Rollback | Fixture restoration reproduces original symlinks, source layout, private state, file modes and shell startup |

Rollback requires both filesystem and repository restoration. Stop writers, preserve any new state created since cutover, restore the old source layout/revision, and restore directory contents, local files and symlinks from the private backup/manifest. A jj undo alone does not restore ignored files or the home directory. Never remove newly generated state without first preserving it.

## Deferred decisions

The first phase needs no password-manager integration choice and does not change SSH key handling. Before phase two, the owner chooses the provider, which secrets should be materialized, and whether disk plaintext or command-scoped retrieval is acceptable. Inventory each machine before deciding which portions of its private shell override can safely become public feature templates.

## References

- [Symlink mode and its limitations](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)
- [Initialization and local data](https://www.chezmoi.io/user-guide/setup/)
- [Source directory attributes](https://www.chezmoi.io/reference/source-state-attributes/)
- [`.chezmoiroot`](https://www.chezmoi.io/reference/special-files/chezmoiroot/)
- [Machine differences](https://www.chezmoi.io/user-guide/manage-machine-to-machine-differences/)
- [Password managers](https://www.chezmoi.io/user-guide/password-managers/)
- [Encryption](https://www.chezmoi.io/user-guide/encryption/)
- [chezmoi configuration](https://www.chezmoi.io/reference/configuration-file/)

Local evidence: `bootstrap.fish`, `.profile`, `.zshenv`, `config/fish/config.fish`, Git/jj configuration, per-application ignore rules, `config/zed/merge-settings.sh`, agent link metadata, and `AGENTS.md`. Private contents and a full historical privacy audit were outside this investigation.
