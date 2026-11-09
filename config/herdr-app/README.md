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

Status is advisory, not proof of task success. The bridge reports state and clears it, but does not report model or facet metadata, blocked-reason text, or implement legacy restore commands. Normal `polytoken continue` and retained session history are unchanged. The bridge does not arrange terminals started by subagents.

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

The `workspace-tasks` layout groups spaces as tasks under their project, with tabs across the top. Projects sort by machine name and full path, with local projects first; closing a task doesn't reorder the remaining projects. Tasks within each project retain Herdr's order. Cmd-B toggles the sidebar, and a right-arrow button with a Show sidebar tooltip appears in the tab bar when it's hidden. Task navigation resumes when the sidebar is shown. `task-tree` manages the sidebar and project picker; `task-doc` opens and autosaves notes in `~/mydesk/tasks`, asks before overwriting external edits, and labels linked terminals with `task.doc`. New notes use `git config user.email` for their owner when available. `task-artifacts` opens a modal listing HTML pages registered by `herdr-artifact add /path/to/page.html [--title "Title"]`; opening one uses Lavish and closes the modal on success. Its search field fuzzy-matches titles and paths, with newest pages first when empty. Enter opens the first match unless you've selected another with Up/Down or Tab/Shift-Tab; selection wraps and keeps the search field focused. Escape or × closes the modal. Failed opens leave the error visible so you can retry. `task-tabs` is a copy of Herdr's tabs mod with an Artifacts button and unread count; Cmd-Shift-A opens the same Artifacts modal, including when the sidebar is hidden. Files and Changes remain side panels. After Herdr updates, compare it with the shipped tabs mod and reapply those additions when re-syncing.

| Keys | Action |
| --- | --- |
| Ctrl-Tab / Ctrl-Shift-Tab | Next / previous task |
| Ctrl-1 through Ctrl-9 | Select a task in the current project |
| Cmd-Option-] / Cmd-Option-[ | Next / previous project |
| Ctrl-Option-1 through Ctrl-Option-9 | Select a project |
| Cmd-N / Cmd-O | New task / open project |
| Cmd-Shift-N | Open or add task notes |
| Cmd-Shift-A | Open Artifacts |
| Cmd-1 through Cmd-9 | Select a tab in the current task |
| Cmd-Shift-] / Cmd-Shift-[ | Next / previous tab |

The project picker fuzzy-matches saved project paths and machine names. For a local `~/` or absolute path, it lists matching child directories of the typed parent, including directory symlinks and hidden folders. Tab fills the first local match. Further presses cycle through the original matches and wrap around, keeping that list visible. Typing starts a new match. Use Up/Down to select a match (Shift-Tab also selects the previous match), then Tab to fill it or Enter to open it. Completion and navigation keep the input focused. Escape closes the picker. Clicking a folder browses into it. The ⇥ and × controls offer completion and closing, with shortcuts in tooltips. Enter without a selection opens the typed path literally.

Complete abbreviated parents one at a time: `~/sr` + Tab, then `ven` + Tab, then the project name. A path with several abbreviated components can match a saved project, but the picker doesn't recursively search the filesystem. Select that saved match with Up/Down and Enter, or cycle to it with Tab. Folder listings are cached until you close the picker.

Word deletion uses Herdr's native binding: Option-Backspace on macOS or Ctrl-Backspace on Linux/Windows. Ctrl-A/Ctrl-E move to the start/end on macOS. Herdr 0.1.14 doesn't expose native input editing operations to mods, so Ctrl-W and additional readline remaps can't be added safely here.

Install these targets after checking for existing files of the same names. The key bindings require the macOS key file.

```sh
chmod +x "$HOME/dotfiles/bin/herdr-artifact"
chezmoi apply "$HOME/.config/herdr-app/keys.json" \
  "$HOME/.config/herdr-app/layouts/workspace-tasks.json" \
  "$HOME/.config/herdr-app/mods/task-tree/main.js" "$HOME/.config/herdr-app/mods/task-tree/mod.json" \
  "$HOME/.config/herdr-app/mods/task-tree/doc-logic.js" "$HOME/.config/herdr-app/mods/task-tree/artifact-logic.js" \
  "$HOME/.config/herdr-app/mods/task-doc/main.js" "$HOME/.config/herdr-app/mods/task-doc/mod.json" "$HOME/.config/herdr-app/mods/task-doc/doc-logic.js" \
  "$HOME/.config/herdr-app/mods/task-artifacts/main.js" "$HOME/.config/herdr-app/mods/task-artifacts/mod.json" "$HOME/.config/herdr-app/mods/task-artifacts/artifact-logic.js" \
  "$HOME/.config/herdr-app/mods/task-tabs/main.js" "$HOME/.config/herdr-app/mods/task-tabs/mod.json" \
  "$HOME/.local/bin/herdr-artifact"
```

Switch with `herdr-app do layout.switch '{"name":"workspace-tasks"}'`; return to `workspace-tree` or `main` by changing the name. To uninstall, switch away first, remove the targets above and their chezmoi source entries, and remove the `layout:workspace-tasks` key section if no longer needed. Notes and registered pages are not deleted.

Run the behavior tests with `node config/herdr-app/tests/tasks.cjs`, `node config/herdr-app/tests/project-picker.cjs`, and `node config/herdr-app/tests/workspace-ui.cjs`. With Herdr installed, `node config/herdr-app/tests/project-picker.cjs --native` and `node config/herdr-app/tests/tasks.cjs --native` also check native initialization and rendering of the project picker and populated artifacts modal. These checks don't simulate keyboard dispatch or verify focus traversal.

## Lavish review pages

`lavish-view` opens an HTML file, a markdown file, or a jj/git diff (`lavish-view diff`) as a Lavish review page without opening a browser window (`--open` does). Inside a herdr terminal (`HC_TERMINAL_ID` set and `herdr-app` on `PATH`) it lists the page under the task's Artifacts; anywhere else, or when the `task-tree` mod isn't loaded, it prints the URL instead. `lavish-view --help` lists the diff range and output options.

The first run installs pinned npm packages, which needs `npm` and network access, and builds the diff page bundle. Later runs reinstall the packages when `package-lock.json` changes and rebuild the bundle when its sources change. Both are cached under `${XDG_DATA_HOME:-$HOME/.local/share}/lavish-view/`, and deleting that directory forces a rebuild. Markdown and diff pages are written under `~/.local/share/polytoken/artifacts/` unless `--out` says otherwise, and never inside the reviewed repository. An HTML file is opened where it is, or copied to `--out`.

The `lavish-plan-view` hook in `config/polytoken/hooks.json` runs on each Polytoken `handoff_plan` call. It opens the session's newest `plan-NNN.md` the same way, in the background, so the handoff isn't delayed. Its output goes to `${XDG_STATE_HOME:-$HOME/.local/state}/lavish-view/plan-hook.log`. Install the command and the hook after checking that `chezmoi diff "$HOME/.config/polytoken/hooks.json"` shows only the new entry:

```sh
chezmoi apply "$HOME/.local/bin/lavish-view" "$HOME/.config/polytoken/hooks.json"
```

Run the tests with `just test-lavish-view`. It installs dev dependencies into `lib/lavish-view/node_modules` and runs the node, hook, and browser suites. The browser suite uses Playwright's cached Chromium and starts and ends its own Lavish session.

## Herdr compatibility mode

Polytoken's [orchestrator documentation](https://docs.polytoken.dev/using-polytoken/tui-orchestrators/) says that in Herdr mode it keeps the terminal in its default input mode to avoid duplicate keystrokes in Herdr panes and external editors. Modified keys such as Shift-Enter may arrive as their base key, and held-key repeats may not be distinguishable from fresh presses. The binding above sends ESC CR while keeping status reporting enabled.

The wrapper sets `HERDR_ENV=1`. Polytoken's documentation says a session started with this variable includes the shipped `herdr` skill, which helps the model inspect panes, coordinate sibling agents, and prompt them. This section follows the official documentation and does not verify that the local 0.9.2 source matches the installed 0.9.6 binary.
