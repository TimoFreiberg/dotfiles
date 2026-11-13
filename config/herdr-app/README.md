# Polytoken in Herdr

`herdr-polytoken` bridges Polytoken's built-in Herdr status reporter to `herdr-core` with OSC 7501. Outside a `herdr-core` terminal, it runs Polytoken without changing its environment. Inside one, it sets the Herdr reporter variables. It does not install hooks, change permissions, or manage session history. `hpt` remains a compatibility command for callbacks from sessions started under the old name.

Fish's `pt` abbreviation expands to `herdr-polytoken`. Start a new shell or run `abbr --add --global pt herdr-polytoken` in an existing Fish shell.

`programs.json` adds Polytoken to Herdr's agent menu as `herdr-polytoken new`. In the default layout, open the menu with the + beside the top tab bar, or in the workspace tree layout (below) with the + on a workspace. Then select Polytoken. This adds Polytoken independently of Herdr's configured fallback shell. The full-color icon comes from [sjennings/polytoken-herdr-core](https://github.com/sjennings/polytoken-herdr-core/blob/0704710dc89c4b4dffd486a5dc644f3ec421c7ce/assets/polytoken.webp). A chezmoi template includes it as a regular file in Herdr's home because external icon symlinks are not supported.

The `keys.json` terminal binding sends ESC CR for Shift-Enter, which Polytoken accepts as a newline. It applies to terminal panes; plain Enter remains unchanged, and Cmd-Shift-Enter still zooms the pane. Remove the `shift-enter` entry to remove the workaround. The key file also contains macOS Cmd shortcuts, so chezmoi deploys it only on macOS and leaves Linux shortcuts unchanged.

The real scripts and configuration live in this repository. The entries under `home/` deploy them with chezmoi. Apply only these targets when installing:

```sh
chmod +x "$HOME/dotfiles/bin/herdr-polytoken" "$HOME/dotfiles/bin/hpt"
mkdir -p "$HOME/.config/herdr-app/polytoken-icons"
chezmoi apply "$HOME/.local/bin/herdr-polytoken" "$HOME/.local/bin/hpt" \
  "$HOME/.config/herdr-app/programs.json" "$HOME/.config/herdr-app/keys.json" \
  "$HOME/.config/herdr-app/polytoken-icons/polytoken.webp"
```

Back up existing unmanaged files before replacing them; do not force a whole-home apply. Herdr reloads configuration live and writes `programs.error` or `keys.error` if it cannot load a file. The menu launcher needs `herdr-polytoken` and `polytoken` on its PATH.

Check the bridge without launching a real model:

```sh
bash -n bin/herdr-polytoken bin/hpt
shellcheck bin/herdr-polytoken bin/hpt
```

Status reporting is advisory; it doesn't prove that a task succeeded. Polytoken's status reporter sends a clear state when the TUI detaches or the agent exits, but doesn't include model, facet, or blocked-reason details. Terminals started by subagents aren't configured by this bridge.

To restore a session in the same Herdr terminal, explicitly run `herdr-polytoken restore` with no additional arguments. For each `working`, `idle`, or `blocked` status update with a valid session ID, the wrapper makes a best-effort write of the session ID and any explicit `--sessions-dir` to terminal labels. If a write fails, a later status update tries again for the same session. If every label write for a new session fails, or you start Polytoken without `herdr-polytoken`, the terminal may still have labels for an earlier session. Stopping or detaching doesn't clear the labels. Restore requires `hc` and `jq` on `PATH` and uses the same data-root environment as the original session, including any `POLYTOKEN_DATA_PATH` or XDG overrides; it doesn't save those settings. If the label or session is unavailable, use `polytoken continue` instead.

## Default shell

The herdr-core configuration sets Fish as the shell for new terminals and keep recovery. Install Fish and ensure it is on `PATH` when applying the template; chezmoi records its absolute path. Check for and back up any existing config before applying this target:

```sh
chezmoi apply "$HOME/.config/herdr-core/config.toml"
```

Restart herdr-core separately when convenient; applying the file does not restart it.

## Workspace tree layout

The `workspace-tree` layout replaces the top tab bar with a sidebar that shows each Herdr space as a collapsible workspace, with its tabs listed beneath as sessions. Click a session to select its space and tab. The chevron folds a workspace, its + starts a terminal or installed agent there, and the + at the top creates a new space. Right-click a workspace or session for Herdr's usual menu. The buttons at the bottom of the sidebar toggle the Files and Changes panels and open Settings and the command palette. The sidebar boundary can be dragged.

In this layout, Ctrl-Tab and Ctrl-Shift-Tab cycle forward and backward through sessions across workspaces, wrapping at either end; Cmd-Shift-] and Cmd-Shift-[ do the same. The order follows the sidebar, including settled sessions and folded workspaces; selecting a folded workspace's session expands it. Machines whose layouts are loading or unavailable are skipped. Cmd-1 through Cmd-9 select workspaces in Herdr's order and restore each workspace's selected tab. These bindings require the macOS key file above; cycling requires the sidebar to be shown. Other layouts keep their original bindings, and Cmd-0 still resets zoom.

Each session row shows its title and the first agent icon in pane order, when available. A count appears after the title when the tab has multiple panes. The representative terminal's working directory appears only when it differs from the first live terminal folder in the workspace (or the stored folder if none is available). Local paths under the current home use `~`; remote paths stay full. The mod prefers an agent terminal when it picks or replaces the representative, and sticks with it across focus and split changes until it closes. A tab you named explicitly shows its name instead. The mod keeps fold state, these terminal choices, and the open panel for each space in its local storage. The active tab still uses Herdr's ordinary pane controls and terminal menus.

Install only the personal layout and mods, after checking for existing files of the same names:

```sh
mkdir -p "$HOME/.config/herdr-app/layouts" \
  "$HOME/.config/herdr-app/mods/workspace-tree" "$HOME/.config/herdr-app/mods/workspace-new"
chezmoi apply "$HOME/.config/herdr-app/layouts/workspace-tree.json" \
  "$HOME/.config/herdr-app/layouts/workspace-tree.svg" \
  "$HOME/.config/herdr-app/mods/workspace-tree/main.js" \
  "$HOME/.config/herdr-app/mods/workspace-tree/mod.json" \
  "$HOME/.config/herdr-app/mods/workspace-new/main.js" \
  "$HOME/.config/herdr-app/mods/workspace-new/mod.json"
herdr-app check "$HOME/.config/herdr-app/mods/workspace-tree"
herdr-app check "$HOME/.config/herdr-app/mods/workspace-new"
herdr-app do layout.switch '{"name":"workspace-tree"}'
```

The chezmoi templates deploy regular files because Herdr cannot load external mod assets. Switch back with `herdr-app do layout.switch '{"name":"main"}'`. Run the behavior tests with `node config/herdr-app/tests/workspace-ui.cjs`. They use stubbed Herdr APIs, so they don't replace trying the layout in the app.

This layout doesn't pick up new Herdr features by itself. After a Herdr update, compare its shipped layouts' workspace and tab controls with this one, and add any newly supported feature that has no place here to the bottom tools.

## Workspace tasks

The `workspace-tasks` layout groups spaces as tasks under their project, with tabs across the top. Projects sort by machine name and full path, with local projects first. Previously opened project groups stay in the sidebar after their last task closes, including after the view restarts. Closing a task doesn't reorder projects. Tasks within each project retain Herdr's order. Cmd-B toggles the sidebar, and a right-arrow button with a Show sidebar tooltip appears in the tab bar when it's hidden. Task navigation resumes when the sidebar is shown. `task-tree` manages the sidebar and project picker. Task rows show a small, dim count immediately after the title when more than one coding agent session is open in that task. The count includes idle, working, and blocked agents across its tabs, excludes ordinary terminal panes, and stays visible when a long title truncates. Project rows have no task count. Task notes are no longer part of this layout. Existing notes in `~/mydesk/tasks` remain untouched. `task-artifacts` opens a modal listing HTML pages registered by `herdr-artifact add /path/to/page.html [--title "Title"]`; opening one uses Lavish and closes the modal on success. Registration stores the artifact unread and shows a notification. On macOS builds whose `web.open` command advertises a `background` argument, it also adds a tab to the terminal's owning task without selecting the tab or changing focus. The tab loads when selected, so automatic opening leaves the artifact unread. Older builds without that argument, and non-macOS builds, only store and notify. Automatic opening respects user-ended Lavish sessions and reports errors without launching an external browser. Choosing an artifact from the picker opens it in the foreground and marks it read on success. It uses a web-view tab on macOS builds with `web.open`, labeled with the artifact title; other builds retain the external-browser path. Its search field fuzzy-matches titles and paths, with newest pages first when empty. Enter opens the first match unless you've selected another with Up/Down or Tab/Shift-Tab; selection wraps and keeps the search field focused. Escape or × closes the modal. Failed opens leave the error visible so you can retry. `task-tabs` is a copy of Herdr's tabs mod with an Artifacts button and unread count; Cmd-Shift-A opens the same Artifacts modal, including when the sidebar is hidden. Files and Changes remain side panels. After Herdr updates, compare it with the shipped tabs mod and reapply those additions when re-syncing.

| Keys | Action |
| --- | --- |
| Cmd-Down / Cmd-Up | Next / previous task |
| Ctrl-1 through Ctrl-9 | Select a task in the current project |
| Cmd-Option-] / Cmd-Option-[ | Next / previous project |
| Ctrl-Option-1 through Ctrl-Option-9 | Select a project |
| Cmd-N / Cmd-O | New task / open project |
| Cmd-Shift-A | Open Artifacts |
| Cmd-1 through Cmd-9 | Select a tab in the current task |
| Ctrl-Tab / Ctrl-Shift-Tab, Cmd-Shift-] / Cmd-Shift-[ | Next / previous tab |

Click an empty project to select it, then use its + or Cmd-N to start a task there. The selection stays through sidebar refreshes until you select another group or Herdr's active task changes. Project navigation also selects empty groups. Each configured machine has a selectable row even before it has a project. Its + or Cmd-N starts a task in that machine's default directory, then groups it by the resolved project path. Unavailable machines stay visible but cannot create tasks.

Right-click a project and choose Remove group to hide an empty group. Groups with live tasks cannot be removed. Removal survives restarts and leaves tasks, files, and picker history untouched. Opening a task in that project restores the group.

The project picker fuzzy-matches saved project paths and machine names. For a local `~/` or absolute path, it lists matching child directories of the typed parent, including directory symlinks and hidden folders. Tab fills the first local match. Further presses cycle through the original matches and wrap around, keeping that list visible. Typing starts a new match. Use Up/Down to select a match (Shift-Tab also selects the previous match), then Tab to fill it or Enter to open it. Completion and navigation keep the input focused. Escape closes the picker. Clicking a folder browses into it. The ⇥ and × controls offer completion and closing, with shortcuts in tooltips. Enter without a selection opens the typed path literally.

Complete abbreviated parents one at a time: `~/sr` + Tab, then `ven` + Tab, then the project name. A path with several abbreviated components can match a saved project, but the picker doesn't recursively search the filesystem. Select that saved match with Up/Down and Enter, or cycle to it with Tab. Folder listings are cached until you close the picker.

Word deletion uses Herdr's native binding: Option-Backspace on macOS or Ctrl-Backspace on Linux/Windows. Ctrl-A/Ctrl-E move to the start/end on macOS. Herdr 0.1.14 doesn't expose native input editing operations to mods, so Ctrl-W and additional readline remaps can't be added safely here.

Install these targets after checking for existing files of the same names. The key bindings require the macOS key file.

```sh
chmod +x "$HOME/dotfiles/bin/herdr-artifact"
chezmoi apply "$HOME/.config/herdr-app/keys.json" \
  "$HOME/.config/herdr-app/layouts/workspace-tasks.json" \
  "$HOME/.config/herdr-app/mods/task-tree/main.js" "$HOME/.config/herdr-app/mods/task-tree/mod.json" \
  "$HOME/.config/herdr-app/mods/task-tree/artifact-logic.js" \
  "$HOME/.config/herdr-app/mods/task-artifacts/main.js" "$HOME/.config/herdr-app/mods/task-artifacts/mod.json" "$HOME/.config/herdr-app/mods/task-artifacts/artifact-logic.js" \
  "$HOME/.config/herdr-app/mods/task-tabs/main.js" "$HOME/.config/herdr-app/mods/task-tabs/mod.json" \
  "$HOME/.local/bin/herdr-artifact"
```

Switch with `herdr-app do layout.switch '{"name":"workspace-tasks"}'`; return to `workspace-tree` or `main` by changing the name. To uninstall, switch away first, remove the targets above and their chezmoi source entries, and remove the `layout:workspace-tasks` key section if no longer needed. Notes and registered pages are not deleted.

Run the behavior tests with `node config/herdr-app/tests/tasks.cjs`, `node config/herdr-app/tests/task-groups.cjs`, `node config/herdr-app/tests/project-picker.cjs`, and `node config/herdr-app/tests/workspace-ui.cjs`. With Herdr installed, `node config/herdr-app/tests/task-groups.cjs --native`, `node config/herdr-app/tests/project-picker.cjs --native`, and `node config/herdr-app/tests/tasks.cjs --native` also check native initialization and rendering of saved groups, the removal popup, task rows with short and long titles and multiple agents, the project picker, and the populated artifacts modal. These checks don't simulate keyboard dispatch or verify focus traversal.

## Lavish review pages

`lavish-view` prepares an HTML file, a markdown file, or a jj/git diff (`lavish-view diff`) as a Lavish review page. Inside a herdr terminal (`HC_TERMINAL_ID` set and `herdr-app` on `PATH`) it attempts to register the page under the task's Artifacts without changing focus. If registration is not acknowledged, it prints the URL and `--open` also launches an external browser. An acknowledged registration does not open a browser. `lavish-view --help` lists the diff range and output options.

Inside herdr, `lavish-view` also starts a relay for the page, whether or not Artifacts registration succeeds. The relay is the page's only Lavish listener (`lavish-axi poll --owner`). It sends each feedback batch as one `hc send` message to the Polytoken session that opened the page, found by the terminal's `polytoken.session` label, so delivery follows a resumed session into a new terminal. If the opening terminal has no session label, the relay delivers to that terminal only. The message holds the page title and path, each prompt with its quoted context, and the `lavish-axi reply` command to answer with. After sending, the relay replies "Delivered to …" on the page so it stops showing Working. Agents must not poll these pages themselves. Outside herdr there is no relay or sidecar, and the agent polls as before.

The relay is a detached Node process, so it outlives the shell or agent that opened the page and needs no task tab. A PID lock keeps it to one per page (by resolved path): opening the page again reuses a running relay, and a lock whose PID is dead is reclaimed on the next open. Failed or timed-out polls, browser disconnects, and `LISTENER_ACTIVE` are retried with capped exponential backoff. The relay never takes over another listener, and it stops if someone takes over its poll. It also stops on fatal `artifact_failures` (after delivering them) and when Lavish reports `NOT_FOUND` (no active session), without reopening the page. End the review with `lavish-axi end "<page>"` or the browser's Send & End. The relay delivers the final feedback before it exits. Reopen an ended page only when the user asks (`--reopen` for a review the user ended).

Files beside the HTML page:

| File | Contents |
| --- | --- |
| `<page>.relay.json` | Delivery target: version, terminal address, `polytoken.session` if present, `herdr.space`, page path and title, optional `sourceFile`, and PR metadata `{repo,rev,head,commits}` under `pr` |
| `<page>.outbox.json` | Feedback the relay has taken from Lavish but not yet delivered. A batch whose save or Create PR hasn't finished keeps its full input and progress. Emptied once `hc send` accepts the message |
| `<page>.relay.lock/pid` | PID of the running relay |
| `<page>.relay-state.lock/pid` | Held briefly while delivering, retargeting, or updating the outbox |

Keep these files local. Outbox entries hold review text and attachment paths, and an unfinished save or Create PR also holds the full document text. Finished entries keep only the forwarded feedback, short notices, and page replies. Logs go to `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-view/relay-<page-hash>.log`, where the hash is the first 16 hex characters of the SHA-256 of the resolved page path. They record lifecycle events and errors, not prompts. To stop only the relay and leave the review open, `kill -TERM` the PID in `<page>.relay.lock/pid`. Nothing restarts a stopped or crashed relay automatically. Open the page through lavish-view again to restart it.

If the session is gone, its label matches more than one live terminal, or `hc send` fails, the relay keeps the feedback in the outbox and posts recovery instructions on the page. It doesn't fall back to the old terminal when a different session runs there. Run:

```sh
lavish-view retarget "<page.html>"              # newest live Polytoken terminal in the recorded space
lavish-view retarget "<page.html>" --terminal T # explicit live terminal address or unique name
```

Retarget records the new target and flushes the outbox, even if the old target is still alive. Without `--terminal`, it fails if no Polytoken terminal is live in the recorded space, if the space or a terminal's creation time is unknown, or if two terminals tie for newest. An explicit `--terminal` can be in another space and needn't have a session label. Retarget needs the page's existing `<page>.relay.json`, and it doesn't reopen a review or restart a relay. If the flush fails, the new target stays recorded, the outbox is untouched, and the command exits nonzero. After a relay crash the outbox can hold a save or Create PR that hasn't finished. Retarget then records the target but can't flush, so open the page through lavish-view to let the restarted relay finish that work, and retarget again if needed.

Retarget waits up to 120 seconds for the state lock, then fails rather than interrupt a send that `hc send` is holding while the user types. Retry after delivery finishes. Lock holders write their PID into the lock directory. A lock with a dead PID can be reclaimed, and one with a missing or partial PID gets a five-second grace period. Don't delete a lock whose PID is still running.

The relay writes feedback to the outbox before sending. If it crashes after `hc` accepts a send but before clearing the outbox, the next open or retarget delivers that batch again, so delivery is at-least-once. Lavish's CLI has no transactional acknowledgement, so feedback can also be lost if the relay dies between receiving a poll result and writing it to the outbox (a small window). A failed page reply is only logged, so a delivered batch can leave the page showing Working until the next reply. If recording the target or starting the relay fails, lavish-view exits with an error instead of running without delivery (the Lavish page may already be open). Startup errors point to the log. Poll output that can't be decoded is logged and forwarded raw for inspection.

The relay also handles two tagged prompts from the editable pages: `lavish-view-save` (Save on task and PR pages) and `lavish-view-action` (Create PR). It answers them on the page and never forwards their contents to the agent as instructions. Malformed or unsupported ones fail on the page. The pages send through Lavish 0.1.96's `window.lavish.queuePrompt(text, options)` followed by `window.lavish.sendQueuedPrompts()`. Lavish appends `options.data` to the prompt text after `Context data:` rather than passing it as a separate poll field, so these prompts carry their payload in the prompt text instead.

### Editable task documents

```sh
lavish-view task "$HOME/mydesk/tasks/example.md" --title "Task document"
```

Pass an existing UTF-8 `.md` or `.markdown` file (there's no default). The page registers under the task's Artifacts with Edit and Rendered views. The preview renders links, tables, task lists, and raw HTML, and hides frontmatter. Lavish's native annotations work on the rendered view. Save or Cmd+S (Ctrl+S on Linux) queues the save and sends it right away, along with any other queued feedback.

The command keeps watching the source until you stop it (there's no `--watch` flag), so run it as a background job. A change on disk updates a clean editor in place. If you have unsaved edits, the page keeps them and offers **Reload (discard mine)** or **Keep mine**. Keep mine bases the next Save on the new disk version. `lavish-axi end <page>` ends the page and its relay but not the watch job, so stop that too when you're done.

Save sends the full text and the SHA-256 of the disk version the edit started from. The relay writes to the source file recorded when the page was opened, never to a path from the browser. If the disk still matches that hash, the relay replaces the file atomically with its permissions intact, replies `Saved`, and sends the agent a short notice to reread the file. The file contents never go into the agent message. Notices travel with other feedback and get the same outbox and retarget handling. If the disk already holds the new text, the relay replies `Saved` without rewriting. If the file changed in some other way, it replies `Conflict` and writes nothing. It checks again just before the rename, but a writer that doesn't go through the relay can still slip in between that check and the rename (POSIX has no conditional rename). Browser edits stay until the disk update arrives or you discard them.

The relay records each batch in the outbox before acting on it, along with the source file and any PR repository and revision at that moment. Reopening a different document at the same page path can't redirect a pending save or Create PR. Delivery and Create PR terminal placement still follow the current target. Each save or launch result is recorded before its input is replaced by the short notice and reply, so retrying a failed outbox write doesn't redo finished work. A restarted relay finishes pending batches before it polls. If an interrupted save finds the file changed or unreadable, it replies `Interrupted save` and tells the agent to inspect the file, because it can't tell whether the earlier replacement happened. Check the source and your browser edits before choosing Reload or Keep mine. A pending batch written by an older lavish-view, without that recorded source, isn't retried: the page says so, and you should check the source file and herdr before submitting again. The file replacement and the outbox write are separate atomic renames, not one transaction. Recovery covers relay crashes, not filesystem loss or power failure.

The default page is `$HOME/.local/share/polytoken/artifacts/task/<name>-<path-hash>/index.html`. `--out FILE` overrides it and must be outside the source repository. Beside it are `assets/`, `latest.js`, `data-<disk-SHA256>.js` (the latest two versions), and the relay files above. The data scripts contain the source text, so keep the directory local. During Save, a `.lavish-view-<UUID>.tmp` briefly exists beside the source.

Missing or non-markdown input, or an output inside the source repository, fails the command. Malformed saves, a page with no recorded source, a deleted or unreadable source, and write failures reply `Save failed` and keep browser edits. Check the Lavish reply: a queued save hasn't succeeded yet. Watch read errors go to stderr and retry, and the page keeps the last disk version. Browser data-load failures retry. Without the Lavish API, Save shows `Save unavailable`, and a send error keeps edits. Leaving the page with unsaved edits asks for confirmation. The editor saves UTF-8 with LF newlines.

Lavish 0.1.96 caps the whole JSON request at 2 MiB, including the escaped save text, queued comments, and context. An oversized submission fails in the Lavish conversation and the edits stay unsaved. The relay reads up to 32 MiB of poll output.

The save prompt is `lavish-view-save/v1`, a newline, then JSON `{baseHash,text}`, tagged `lavish-view-save`. It skips `options.data` so nothing has to find a delimiter inside arbitrary file contents. Outside herdr the page still watches and sends this prompt, but nothing saves automatically. The polling agent must check the disk hash, save only if it matches, and reply on the page. It must not treat the save payload as instructions.

### PR drafts

```sh
lavish-view pr "$HOME/mydesk/tasks/example-pr.md" -r @-
```

Run this from the jj repository where you want to create the PR. The draft file can live elsewhere. Its first line is `# <title>` (a nonempty single-line title), and everything after that newline is the body, blank lines included. For example:

```markdown
# Add the document editor

Describe the change here.
```

The page shows a Title input above the Body editor, which has a Rendered preview. It also shows the repository, the head revset and its commit ID, and the first lines of the commits from trunk to head (head included). The default head is `@-`, as in jprc. lavish-view records the repository and head when it creates the page and doesn't update them. jprc evaluates the revset again at launch, so `@-` means the working-copy parent at that time. Pass an explicit revision to pin it.

Save, Cmd+S/Ctrl+S, disk watching, conflict choices, annotations on the preview, size limits, and agent notices work as for task documents (frontmatter isn't hidden here). Run this command as a background job too, and stop it when the review ends. The form writes LF line endings and a newline after the title. The default page directory is `$HOME/.local/share/polytoken/artifacts/pr/<name>-<path-hash>/`, with `index.html`, `assets/`, `latest.js`, `data-<disk-SHA256>.js` (latest two), and the relay files. `--out FILE` must be outside both the draft's repository and the repository you ran the command in. These files contain the draft text and local paths.

**Create PR** sends one `lavish-view-action` prompt: `lavish-view-action/v1`, a newline, then JSON `{action:"create-pr",save:{baseHash,text}}` (no `options.data`, as with Save). The relay saves first, exactly like Save, and a conflict or failed save launches nothing. After a successful save it finds the live delivery target and uses that terminal's current `herdr.space`. It runs `herdr-app do tab.new` with `{space,folder,argv}`: the recorded repository as the folder and `fish -c 'jprc -r REV --body-file FILE'` with quoted arguments. It never types into the agent's terminal or falls back to the active space. The page reply names the command, repository, space, and tab. Continue in that terminal for jprc's base, bookmark, and branch prompts, the push, and the browser step. herdr acknowledging the launch doesn't mean a PR was created.

The relay records the save and the launch attempt before calling herdr. If it crashes before recording herdr's answer, the restarted relay restores the save notice and replies that the launch is uncertain instead of opening a second terminal (the crash may also have prevented the launch). Check herdr for the Create PR terminal before submitting again, since every submit is a new launch request.

A malformed first line, running outside a jj repository, or a head that isn't exactly one commit fails page creation. If the draft on disk becomes invalid, the page shows `Disk update failed` and keeps browser edits until you fix the file. An empty title can't be submitted. A malformed or unsupported action, or a page without recorded PR metadata, replies `Create PR failed` without launching. A missing or ambiguous target, or a target without a space, needs `lavish-view retarget` before another attempt. If herdr-app is unavailable, the space is closed or unknown, herdr returns an error, or it doesn't acknowledge the new terminal, Create PR fails on the page without trying another space. The save stays done either way. Errors from fish, jprc, or gh appear in the new terminal. Outside herdr nothing saves or launches automatically: the polling agent does the conditional save and replies, then asks the user to run jprc in fish.

`jprc [-r REV] [-b BASE] --body-file FILE` reads the same draft format and passes the title and body to `gh pr create --web --title ... --body ...`. A multiline body (trailing newlines included) stays one argument. Base detection, branch naming, and push work as without the flag. If an open PR already exists for the branch, jprc opens it and ignores the draft, even if the file is missing. Without `--body-file`, jprc uses the commit descriptions and the base revision's PR template. A missing or unreadable file, or a malformed title line, fails PR creation, possibly after jprc has already pushed the branch. `jprc --help` lists the flag and these failures. Deploy the function before using Create PR:

```sh
chezmoi apply "$HOME/.config/fish/functions/jprc.fish"
fish -c 'jprc --help'
```

### Diff reviews

Generated diff pages start with native Annotate off; you can still enable it from Lavish's toolbar. Diff line comments use the page's own controls and enter Lavish's feedback queue with the path, old/new side, revision, and quoted source. Lavish's native annotations see the diff renderer's shadow host rather than the clicked line. Click a code line or select a range in its line-number gutter to open a comment beside it.

### Install and tests

The first run installs pinned npm packages, which needs `npm` and network access, and builds the diff page bundle. Later runs reinstall the packages when `package-lock.json` changes and rebuild the bundle when its sources change. Both are cached under `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-view/`, and deleting that directory forces a rebuild. Markdown and diff pages are written under `~/.local/share/polytoken/artifacts/` unless `--out` says otherwise, and never inside the reviewed repository. An HTML file is opened where it is, or copied to `--out`.

The `lavish-plan-view` hook in `config/polytoken/hooks.json` runs on each Polytoken `handoff_plan` call. It opens the session's newest `plan-NNN.md` the same way, in the background, so the handoff isn't delayed. Its output goes to `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-view/plan-hook.log`. Install the command and the hook after checking that `chezmoi diff "$HOME/.config/polytoken/hooks.json"` shows only the new entry:

```sh
chezmoi apply "$HOME/.local/bin/lavish-view" "$HOME/.config/polytoken/hooks.json"
```

Run the tests with `just test-lavish-view`. It installs dev dependencies into `lib/lavish-view/node_modules` and runs the node, hook, and browser suites. The browser suite uses Playwright's cached Chromium and starts and ends its own Lavish session. The suite also runs jprc against a local bare repository as origin and a stub gh, with and without `--body-file` and with an existing PR.

To check real delivery inside herdr, run `node lib/lavish-view/test/relay-e2e.mjs` from a jj repository (it isn't part of `just test-lavish-view`). It creates a scratch space with two `cat` terminals, moves a fake session label between them to check that browser feedback follows the label, and checks a task page's saved bytes and agent notice. It also saves a PR page and runs Create PR through the real `tab.new`, checking the new terminal's space and tab, working directory, draft contents, and jprc arguments. A wrapper around the herdr-app CLI gives that terminal a scratch fish config with stub jprc and gh, so nothing reaches GitHub. The script ends both pages and removes its watchers, relays, logs, scratch space, terminals, and temporary files. It never sends to the terminal you run it from.

## Herdr compatibility mode

Polytoken's [orchestrator documentation](https://docs.polytoken.dev/using-polytoken/tui-orchestrators/) says that in Herdr mode it keeps the terminal in its default input mode to avoid duplicate keystrokes in Herdr panes and external editors. Modified keys such as Shift-Enter may arrive as their base key, and held-key repeats may not be distinguishable from fresh presses. The binding above sends ESC CR while keeping status reporting enabled.

The wrapper sets `HERDR_ENV=1`. Polytoken's documentation says a session started with this variable includes the shipped `herdr` skill, which helps the model inspect panes, coordinate sibling agents, and prompt them. This section follows the official documentation and does not verify that the local 0.9.2 source matches the installed 0.9.6 binary.
