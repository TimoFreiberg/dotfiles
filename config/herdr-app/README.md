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

Inside herdr, `lavish-view` also starts one relay per canonical page, whether or not Artifacts registration succeeds. It polls exclusively with an owner label and sends each feedback batch as one `hc send` message to the opening Polytoken session. Session labels let delivery follow a resumed session to a new terminal. Without a session label, it uses the original terminal only. When `hc ls` provides only summary rows, it fetches labels and creation times with `hc get`. The message includes the page title/path, prompt text and quoted context, and a `lavish-axi reply` command. The relay then replies “Delivered to …” so the page stops showing Working. The agent must not poll these pages itself. Outside herdr, no relay or sidecar is created and the agent polls as before.

The relay is a detached Node process with a per-page PID lock and an acknowledged startup, rather than an untracked shell background poll. This keeps it alive after the opening shell or agent exits without adding a task tab. Repeated opens and `--watch` share the same lock. Dead-PID locks are reclaimed on the next open. The relay retries crashed/timed-out polls, browser disconnects, and `LISTENER_ACTIVE` with capped exponential backoff. It never takes over another listener. If someone explicitly takes over its poll, the displaced relay stops. Fatal `artifact_failures` stop the relay after delivering their details. End the review with `lavish-axi end "<page>"` or the browser's Send & End; final feedback is delivered before exit. Open an ended page again only when the user requests it (`--reopen` for a user-ended review).

Files beside the canonical HTML page:

| File | Contents |
| --- | --- |
| `<page>.relay.json` | Version, terminal address, `polytoken.session` if present, `herdr.space`, page path/title, optional `sourceFile`, and PR metadata `{repo,rev,head,commits}` under `pr` |
| `<page>.outbox.json` | Consumed feedback batches with IDs/receipt times, pending handler inputs, receipt-time targets and checkpoints, then short notices/replies; emptied after an accepted send |
| `<page>.relay.lock/pid` | Live relay PID |
| `<page>.relay-state.lock/pid` | Short-lived lock serializing delivery, target changes, and outbox updates |

Keep these files local. Pending outbox entries contain the full save/action text as well as review text and attachment paths. Completed entries retain only the forwarded feedback, short notices and page replies. Logs are `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-view/relay-<page-hash>.log` (the hash is the first 16 hex characters of SHA-256 of the canonical page path). They contain lifecycle/error reports, not a copy of every prompt. To stop only the relay without ending the review, send `kill -TERM` to the PID recorded in `<page>.relay.lock/pid`. Opening the page through lavish-view again restarts it. A crashed relay is likewise restarted by reopening through lavish-view; there is no OS service that restarts it automatically.

If the session is gone, its label matches multiple live terminals, or `hc send` fails, the relay retains feedback in the outbox and posts recovery instructions on the page. It does not fall back to a different session in the old terminal. Run:

```sh
lavish-view retarget "<page.html>"              # newest live Polytoken terminal in the recorded space
lavish-view retarget "<page.html>" --terminal T # explicit live terminal address or unique name
```

Retarget updates the target and flushes the outbox, even if the previous target is still alive. Without `--terminal`, no matching terminal, a missing space/creation timestamp, or a tie for newest fails clearly. Explicit targets may be in another space or have no session label. Retarget requires an existing relay sidecar and does not reopen a review or restart an ended relay. A failed flush leaves the new target recorded and the outbox intact; the command exits nonzero. A state lock busy for 120 seconds fails rather than interrupting a send held by herdr's draft wait. Retry after delivery finishes. Lock owners and stale-lock reclaimers both record their PID. Dead PIDs can be reclaimed, while a missing/partial PID gets a five-second grace period. Each retry observes the same deadline, including when a reclaimer is busy. If an outbox still has unfinished handlers, retarget records the new target but cannot flush yet. Open the page through lavish-view to restart recovery, then retry retarget if needed.

Feedback is saved before sending. If the relay crashes after `hc` accepts a send but before clearing the outbox, the next open or retarget can deliver that batch again (at-least-once delivery). There is also a small unavoidable window between Lavish consuming poll feedback and the relay receiving/persisting it; Lavish's CLI does not offer a transactional acknowledgement. Failed page replies are logged, so an accepted delivery can leave the page showing Working until a later reply. Metadata or relay-startup errors fail lavish-view rather than silently dropping automatic delivery; the Lavish page may already be open. Startup errors point to the log. A missing relay sidecar makes retarget fail without starting anything. If poll output cannot be decoded, the relay retains/forwards that raw output for inspection and logs the error before retrying. If Lavish reports `NOT_FOUND` (no active session), the relay stops without reopening the page. Do not delete a lock whose PID is still running.

The relay handles `lavish-view-save` for task and PR documents and `lavish-view-action` for Create PR. Unknown or malformed actions fail on the page. Save/action contents never become agent instructions. Lavish 0.1.96 supports `window.lavish.queuePrompt(text, options)` followed by `window.lavish.sendQueuedPrompts()` for an immediate send. `options.data` is JSON appended to prompt text after `Context data:`, not a separate poll field.

### Editable task documents

```sh
lavish-view task "$HOME/mydesk/tasks/example.md" --title "Task document"
```

Pass an existing UTF-8 `.md` or `.markdown` file. There is no default source path. The page registers under the task's Artifacts and offers Edit and Rendered views. The preview uses the existing markdown typography, links, tables, and task lists. Frontmatter is hidden there and raw HTML renders as it does in ordinary markdown pages. Native Lavish annotations work on the rendered document. Save and Cmd+S (Ctrl+S on Linux) queue and send immediately, including any other queued feedback.

Keep the command running as a background job for the review: task pages always watch the source, without a `--watch` flag. Disk changes update a clean editor without reloading. With unsaved edits, the page keeps them and offers **Reload (discard mine)** or **Keep mine**. Keep mine bases the next Save on the new disk hash. Stop the watch job when done, and use `lavish-axi end <page>` to end the page and relay. Ending the page does not stop the watch job.

The relay saves to the canonical `sourceFile` recorded with the consumed batch, never to a browser-supplied path. Each pending batch keeps the handler target from receipt time, including PR repository/revision. Reopening another document at the same page path cannot redirect pending saves or PR actions to the replacement source or repository. Delivery and Create PR terminal placement still resolve the current target session. Older pending batches without a recorded handler target refuse unfinished save/action work on the page; inspect the source file and herdr before submitting again. Save sends full text and the original disk SHA-256. If the hash matches, the relay preserves permissions and atomically replaces the file, replies `Saved`, and sends the agent a short notice to read it. Full contents never enter the agent message. The outbox stores the consumed input before saving and checkpoints each handler result before replacing its input with a short notice/reply. A transient outbox failure retries persistence without rerunning completed handlers. Restart processes pending batches before polling. If the disk already matches the requested text, recovery replies `Saved` and restores the notice without rewriting. Notices batch with comments and use the outbox/retarget behavior. Other changed disk hashes reply `Conflict` without writing during normal saves. If an interrupted save encounters later disk changes or an unreadable source, recovery replies `Interrupted save` and sends an inspection notice, since it cannot tell whether the earlier replacement succeeded. Inspect the source and browser edits before choosing Reload or Keep mine. Source replacement and outbox writes are separate atomic renames, not a cross-file transaction. These checkpoints cover worker crashes, not filesystem loss or power-failure durability. Browser edits stay until the disk update arrives or you discard them. The relay rechecks after preparing the replacement, but an unrelated writer can race the final check and rename (POSIX has no conditional rename).

The default page is `$HOME/.local/share/polytoken/artifacts/task/<name>-<path-hash>/index.html`. `--out FILE` overrides it and must be outside the source repository. Beside it are `assets/`, `latest.js`, and `data-<disk-SHA256>.js` (the latest two versions), plus the relay files above. These scripts contain source text; keep the directory local. A `.lavish-view-<UUID>.tmp` beside the source exists briefly during Save and is removed afterward.

Missing/non-markdown input and an output inside the source repository fail the command. Malformed saves, missing sidecar source, deleted/unreadable source, or write failures reply `Save failed` and keep browser edits. Check the Lavish reply for the result: queuing is not a successful save. Watch read errors go to stderr and retry, keeping the last disk version. Browser data-load failures retry. Save without the Lavish API shows `Save unavailable`; a send error keeps edits. Leaving the page warns about unsaved edits. The textarea saves UTF-8 with LF newlines.

Lavish 0.1.96 caps the complete JSON request at 2 MiB, including escaped save text, queued comments, and context. Oversized submissions fail in the Lavish conversation; browser edits stay unsaved. The relay's poll output buffer is 32 MiB.

The save prompt is `lavish-view-save/v1`, a newline, then JSON `{baseHash,text}`, tagged `lavish-view-save`. It does not use `options.data`, avoiding delimiter parsing inside arbitrary file contents. Outside herdr, the page watches and sends this envelope to the polling agent, but no relay saves automatically. The agent must check the disk hash, save conditionally, and reply on the page. Invalid save payloads must not become agent instructions.

### PR drafts

```sh
lavish-view pr "$HOME/mydesk/tasks/example-pr.md" -r @-
```

Run this from the jj repository where you want to create the PR. The source can live elsewhere. Its first line is `# <title>` (a nonempty single-line title), and everything after that newline is the body, including blank lines. For example:

```markdown
# Add the document editor

Describe the change here.
```

The page shows a Title input above the Body editor, with a Rendered preview. It also shows the repository, head revset and commit ID, and commit first lines between trunk and head (including head). The default head is `@-`, like jprc. Repository/head metadata is captured at page creation, not watched. The recorded revset is evaluated again by jprc at launch, so `@-` follows the working-copy parent at that time. Pass an explicit revision if it must stay fixed.

Save, Cmd+S/Ctrl+S, disk watching, conflict choices, annotations on the preview, transport limits, and agent notices work like task documents above. Keep this command running as a background job, then stop it when the review ends. The form writes LF line endings and a newline after the title. The default page directory is `$HOME/.local/share/polytoken/artifacts/pr/<name>-<path-hash>/`, with `index.html`, `assets/`, `latest.js`, `data-<disk-SHA256>.js` (latest two), and the relay files. `--out FILE` must be outside both the source repository and the repository where you ran the command. These files contain the draft text and local paths.

**Create PR** sends one `lavish-view-action` prompt: `lavish-view-action/v1`, a newline, then JSON `{action:"create-pr",save:{baseHash,text}}`. It avoids `options.data` like Save. The relay performs the same conditional save first. A conflict or failed save launches nothing. After a successful save, it resolves the live delivery target and uses that terminal's current `herdr.space`. It calls `herdr-app do tab.new` with explicit `{space,folder,argv}`: the recorded repository folder and `fish -c 'jprc -r REV --body-file FILE'`, with quoted arguments. It doesn't paste into the agent terminal or fall back to the active space. The page reply names the launched command, repo, space, and tab. Continue in that terminal for jprc's base/bookmark/branch prompts, push, and browser flow. A launch acknowledgement isn't confirmation that a PR was created. Before calling herdr, the relay checkpoints the successful save and launch attempt. Completed results survive transient persistence retries. After a crash with an unresolved launch attempt, the relay restores the save notice and replies that the launch is uncertain instead of opening another terminal. This can also mean a crash prevented the launch altogether. Check herdr for the Create PR terminal before submitting a new action, which counts as a new launch request.

Malformed first lines, a non-jj invocation directory, or an invalid/multiple head revision fail page creation. An invalid watched draft shows `Disk update failed` and keeps browser edits until the source is fixed. Empty form titles can't be submitted. Malformed/unsupported action envelopes and missing PR sidecar metadata reply `Create PR failed` without launching. A missing/ambiguous target or missing space requires retargeting before another attempt. An unavailable herdr app, closed/unknown space, app error, or unacknowledged terminal launch fails visibly without choosing another space. A successful save stays saved when launch fails. Check herdr before retrying an uncertain launch. Errors from fish, jprc or gh appear in the new terminal. Outside herdr, no relay saves or launches automatically: the polling agent handles the conditional save and reply, then asks the user to run jprc in fish.

`jprc [-r REV] [-b BASE] --body-file FILE` reads the same draft format and passes its title/body as `gh pr create --web --title ... --body ...`. Multiline bodies (including trailing newlines) stay one argument. Base detection, branch naming, push, and opening an existing PR are unchanged. An existing PR opens even if the supplied draft is missing. Without `--body-file`, jprc still uses commit descriptions and the base revision's PR template. Missing/unreadable files and malformed titles fail new PR creation after the branch may already have been pushed. `jprc --help` lists the flag and failures. Deploy the updated autoload function before using Create PR:

```sh
chezmoi apply "$HOME/.config/fish/functions/jprc.fish"
fish -c 'jprc --help'
```

### Diff reviews

Generated diff pages start with native Annotate off; you can still enable it from Lavish's toolbar. Diff line comments use the page's own controls and enter Lavish's feedback queue with the path, old/new side, revision, and quoted source. Lavish's native annotations see the diff renderer's shadow host rather than the clicked line. Click a code line or select a range in its line-number gutter to open a comment beside it.

The first run installs pinned npm packages, which needs `npm` and network access, and builds the diff page bundle. Later runs reinstall the packages when `package-lock.json` changes and rebuild the bundle when its sources change. Both are cached under `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-view/`, and deleting that directory forces a rebuild. Markdown and diff pages are written under `~/.local/share/polytoken/artifacts/` unless `--out` says otherwise, and never inside the reviewed repository. An HTML file is opened where it is, or copied to `--out`.

The `lavish-plan-view` hook in `config/polytoken/hooks.json` runs on each Polytoken `handoff_plan` call. It opens the session's newest `plan-NNN.md` the same way, in the background, so the handoff isn't delayed. Its output goes to `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-view/plan-hook.log`. Install the command and the hook after checking that `chezmoi diff "$HOME/.config/polytoken/hooks.json"` shows only the new entry:

```sh
chezmoi apply "$HOME/.local/bin/lavish-view" "$HOME/.config/polytoken/hooks.json"
```

Run the tests with `just test-lavish-view`. It installs dev dependencies into `lib/lavish-view/node_modules` and runs the node, hook, and browser suites. The browser suite uses Playwright's cached Chromium and starts and ends its own Lavish session. To check real relay delivery inside herdr, run `node lib/lavish-view/test/relay-e2e.mjs` from a jj repository. It creates a scratch space with two `cat` terminals, labels them with a fake session, verifies browser delivery follows the label, and checks the task page's exact save and short agent notice. It also saves a PR page and runs Create PR through real `tab.new`, verifying the terminal's space/tab labels, repo cwd, draft contents, and jprc arguments. Its app CLI wrapper injects a scratch fish autoload config and stub jprc/gh into that new terminal, so nothing touches GitHub. It ends both pages and removes its own watchers, relays, logs, scratch space/tabs/terminals, and temporary files. It never sends to the caller's terminal. The automated jprc test also uses a local bare fake origin and stub gh, including existing-PR and no-flag regression checks.

## Herdr compatibility mode

Polytoken's [orchestrator documentation](https://docs.polytoken.dev/using-polytoken/tui-orchestrators/) says that in Herdr mode it keeps the terminal in its default input mode to avoid duplicate keystrokes in Herdr panes and external editors. Modified keys such as Shift-Enter may arrive as their base key, and held-key repeats may not be distinguishable from fresh presses. The binding above sends ESC CR while keeping status reporting enabled.

The wrapper sets `HERDR_ENV=1`. Polytoken's documentation says a session started with this variable includes the shipped `herdr` skill, which helps the model inspect panes, coordinate sibling agents, and prompt them. This section follows the official documentation and does not verify that the local 0.9.2 source matches the installed 0.9.6 binary.
