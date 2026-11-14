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

The `workspace-tasks` layout groups spaces as tasks under their project, with tabs across the top. `task-tree` draws the sidebar and project picker, `task-artifacts` lists HTML pages, `task-agents` lists hidden agents, and `task-tabs` is the tab bar. Files and Changes remain side panels.

### Sidebar

Projects sort by machine name and full path, with local projects first. A project group stays in the sidebar after its last task closes, including after the view restarts, and closing a task doesn't reorder projects. Tasks within each project keep Herdr's order. Cmd-B toggles the sidebar; while it's hidden, a right-arrow button with a Show sidebar tooltip appears in the tab bar, and task navigation resumes once it's shown again.

A task row shows a small, dim count right after its title when more than one coding agent session is open in that task. The count covers idle, working, and blocked agents across the task's tabs, leaves out ordinary terminal panes, and stays visible when a long title is truncated. Project rows have no count.

### Agents

The Agents button opens the current task's live coding agents that don't have a pane. Search by name, address, or status; use Up/Down or Tab/Shift-Tab to select, Enter to open, and Escape to close. Opening keeps the existing terminal in a new tab. If it acquired a pane in the meantime, Herdr focuses that pane instead. Keep runs in the background; Herdr reports failures in a toast. The task must still be selected when you open the agent. If you switch tasks before the keep finishes, Herdr may focus the new tab and return you to the original task.

The task icon and Agents button use the same priority: blocked, done, working, idle, then no status. This includes hidden agents found through a pane-backed ancestor or a task label on the same machine. The tab bar remembers observed task associations while a terminal remains live, including when its parent exits or it is parked. A terminal without an observed task association cannot be placed safely. The list includes registered agent programs and programs reporting agent status, but not ordinary shells or completed terminals. A hidden agent's error means blocked; an observed transition to done, or from working or blocked to idle, means done until viewed. A first observation of raw done is also unseen unless its shared seen turn says otherwise. Done means an unseen finished turn, not that the process has exited.

### Artifacts

`herdr-artifact add /path/to/page.html [--title "Title"]` registers an HTML page with the task that owns the calling terminal; lavish-kit (below) registers its pages through the same `task-tree` command. The page is stored as unread and Herdr shows a notification. On macOS builds whose `web.open` command takes a `background` argument, registration also adds a web-view tab to the task without selecting it or changing focus. The tab loads only when you select it, so the artifact stays unread until then. Other builds only store and notify. Automatic opening respects Lavish reviews the user has ended, and it reports errors instead of falling back to an external browser.

Cmd-Shift-A, or the Artifacts button with its unread count in the tab bar, opens a modal listing the task's pages, newest first. The search field fuzzy-matches titles and paths. Enter opens the first match unless you've picked another with Up/Down or Tab/Shift-Tab; the selection wraps and the search field keeps focus. Opening a page runs it through Lavish, marks it read, and closes the modal. On macOS builds with `web.open` the page opens in a web-view tab labeled with its title; other builds use an external browser. If opening fails, the error stays in the modal so you can retry. Escape or × closes it. The shortcut works while the sidebar is hidden.

`task-tabs` is a copy of Herdr's tabs mod with the Agents and Artifacts buttons added. After a Herdr update, compare it with the shipped tabs mod and reapply the buttons when re-syncing.

### Keys and projects

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

Word deletion uses Herdr's native binding: Option-Backspace on macOS or Ctrl-Backspace on Linux/Windows. Ctrl-A/Ctrl-E move to the start/end on macOS. As of Herdr 0.1.14, mods can't call native input editing operations, so Ctrl-W and other readline bindings aren't added here.

### Install and test

Install these targets after checking for existing files of the same names. The key bindings require the macOS key file.

```sh
chmod +x "$HOME/dotfiles/bin/herdr-artifact"
chezmoi apply "$HOME/.config/herdr-app/keys.json" \
  "$HOME/.config/herdr-app/layouts/workspace-tasks.json" \
  "$HOME/.config/herdr-app/mods/task-tree/main.js" "$HOME/.config/herdr-app/mods/task-tree/mod.json" \
  "$HOME/.config/herdr-app/mods/task-tree/artifact-logic.js" "$HOME/.config/herdr-app/mods/task-tree/agent-logic.js" \
  "$HOME/.config/herdr-app/mods/task-artifacts/main.js" "$HOME/.config/herdr-app/mods/task-artifacts/mod.json" "$HOME/.config/herdr-app/mods/task-artifacts/artifact-logic.js" \
  "$HOME/.config/herdr-app/mods/task-agents/main.js" "$HOME/.config/herdr-app/mods/task-agents/mod.json" "$HOME/.config/herdr-app/mods/task-agents/agent-logic.js" \
  "$HOME/.config/herdr-app/mods/task-tabs/main.js" "$HOME/.config/herdr-app/mods/task-tabs/mod.json" "$HOME/.config/herdr-app/mods/task-tabs/agent-logic.js" \
  "$HOME/.local/bin/herdr-artifact"
```

Switch with `herdr-app do layout.switch '{"name":"workspace-tasks"}'`; return to `workspace-tree` or `main` by changing the name. To uninstall, switch away first, remove the targets above and their chezmoi source entries, and remove the `layout:workspace-tasks` key section if no longer needed. Registered pages are not deleted.

Run each behavior test file separately; `node` runs only the first file it's given:

```sh
for t in tasks task-groups project-picker workspace-ui task-agents; do node "config/herdr-app/tests/$t.cjs"; done
```

With Herdr installed, `tasks.cjs`, `task-groups.cjs`, `project-picker.cjs`, and `task-agents.cjs` also accept `--native`. That checks native initialization and rendering of saved groups, the removal popup, task rows with short and long titles and several agents, the project picker, and the populated Artifacts modal. These checks don't simulate keyboard dispatch or verify focus traversal.

## Lavish review pages

[lavish-kit](https://github.com/TimoFreiberg/lavish-kit) is an unofficial add-on for [Lavish](https://github.com/kunchenguid/lavish-axi). It opens HTML files, editable Markdown, jj/git diffs, and PR drafts as review pages. Every command returns once the page's background worker has started, and the worker keeps the page up to date until the Lavish session ends.

Inside herdr, lavish-kit lists pages under the task's Artifacts and delivers feedback to the agent session that opened the page, so agents don't poll those pages. A worker started outside herdr only watches, and the agent polls. Reopening a page outside herdr keeps a worker that's already delivering, so agents follow the feedback line lavish-kit prints rather than assuming. The project's README and `lavish-kit --help` cover requirements, commands, recovery, and tests.

mise installs lavish-kit from its GitHub `main` branch (`config/mise/config.toml`, next to `lavish-axi`). lavish-kit needs Node.js 22 or newer and npm, which mise also provides. `mise install` fetches `main` once; run `mise install -f http:lavish-kit` to pick up newer pushes (`mise up` doesn't). To try unpushed changes, run `bin/lavish-kit` from a checkout directly.

```sh
mise install http:lavish-kit
chezmoi diff "$HOME/.config/lavish-kit/config.json"
chezmoi apply "$HOME/.config/lavish-kit/config.json" \
  "$HOME/.config/polytoken/hooks.json" "$HOME/.config/fish/functions"
```

Earlier setups linked `~/.local/bin/lavish-kit` to a checkout. chezmoi no longer manages that link and won't remove it; delete it with `rm "$HOME/.local/bin/lavish-kit"`.

The managed `lavish-kit/config.json` sets `createPr` to `["fish", "-c", "jprc $argv", "--"]`. lavish-kit appends `-r REV --body-file FILE`, so the fish `jprc` function (`config/fish/functions/jprc.fish`) must keep its `--body-file` option. A PR page's Create PR button saves the draft, then runs that command in a new herdr tab in the recorded repository. Generated pages default to `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-kit/pages/`.

The `lavish-plan-view` hook in `config/polytoken/hooks.json` runs before `handoff_plan` and opens the session's newest `plan-NNN.md`. It starts lavish-kit in the background, so a first run that installs dependencies doesn't hold up the handoff, and passes `--out` to keep the page at `$HOME/.local/share/polytoken/artifacts/plan/<session>/index.html`. Output and failures go to `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-kit/plan-hook.log`. `just test-lavish-plan-view` tests the hook against a stub `lavish-kit` without opening a Lavish session; lavish-kit's own tests live in its checkout.

## Herdr compatibility mode

Polytoken's [orchestrator documentation](https://docs.polytoken.dev/using-polytoken/tui-orchestrators/) says that in Herdr mode it keeps the terminal in its default input mode to avoid duplicate keystrokes in Herdr panes and external editors. Modified keys such as Shift-Enter may arrive as their base key, and held-key repeats may not be distinguishable from fresh presses. The binding above sends ESC CR while keeping status reporting enabled.

The wrapper sets `HERDR_ENV=1`. Polytoken's documentation says a session started with this variable includes the shipped `herdr` skill, which helps the model inspect panes, coordinate sibling agents, and prompt them. Both statements come from Polytoken's documentation and weren't checked against the installed binary.
