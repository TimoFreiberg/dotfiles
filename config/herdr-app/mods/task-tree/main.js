import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { spaces, panes, agents, terminals, machines, theme, run, openOverlay, closeOverlay, window, props, home, nextCommand, exec, notify, readTextFile, writeTextFile, shared, setShared } from "herdr";
import { slugify, template } from "./doc-logic.js";
import { artifactKey, addArtifact, artifactSpace } from "./artifact-logic.js";

function key(machine, folder) { return JSON.stringify([machine ?? null, folder]); }
function groupSpaces(list, assignments, projects = [], configuredMachines = []) {
  const groups = [], byKey = {};
  const add = ({machine, root}) => {
    machine = machine ?? null;
    const id = key(machine, root);
    if (!byKey[id]) { byKey[id] = { id, root, machine, tasks: [] }; groups.push(byKey[id]); }
    return byKey[id];
  };
  for (const project of projects) add(project);
  for (const space of list) {
    const assignment = assignments[space.id];
    if (assignment) add(assignment).tasks.push(space);
  }
  for (const machine of configuredMachines) {
    const name = machine.name ?? null;
    if (!groups.some(group => group.machine === name)) {
      groups.push({id:key(name, null), machine:name, root:"", tasks:[], fallback:true});
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return groups.sort((a, b) => Number(a.machine != null) - Number(b.machine != null)
    || compare(a.machine ?? "", b.machine ?? "") || compare(a.root, b.root));
}
function firstTerminal(space, all) {
  for (const tab of space.tabs) { const pane = all.find(p => p.tab === tab.id && p.terminal); if (pane) return pane; }
  return null;
}
function taskAgent(space, allAgents) { return allAgents.find(a => a.space === space.id); }
function taskTitle(space, agent) { return space.named ? space.name : (agent?.title || space.name); }
function pin(assignments, id, assignment) { if (assignments[id]) return false; assignments[id] = assignment; return true; }
function step(items, current, direction) {
  if (!items.length) return null;
  const index = items.findIndex(x => x.id === current);
  return items[index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length];
}
function nth(items, number) { return Number.isInteger(number) && number > 0 ? items[number - 1] ?? null : null; }
function load(key) { try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; } }
function history(history, assignments) {
  const seen = new Set(), result = [];
  for (const item of [...history, ...Object.values(assignments)]) {
    if (!item || !item.root) continue;
    const id = key(item.machine, item.root); if (seen.has(id)) continue;
    seen.add(id); result.push({machine: item.machine ?? null, root: item.root});
  }
  return result;
}
function savedGroups(assignments) {
  const saved = load("project-groups");
  if (Array.isArray(saved.projects) && Array.isArray(saved.removed)) return saved;
  const previous = load("project-history");
  return {projects:history(Array.isArray(previous) ? previous : [], assignments), removed:[]};
}
function storeGroups(state) {
  const value = JSON.stringify(state);
  if (localStorage.getItem("project-groups") === value) return;
  localStorage.setItem("project-groups", value);
  setShared("task-project-update", Math.random());
}
function repoRoot(folder, jj, git) { return jj?.trim() || git?.trim() || folder; }
function movePin(assignments, id, assignment) { assignments[id] = assignment; }
function fuzzyScore(value, query) {
  value = value.toLowerCase(); query = query.toLowerCase();
  if (!query) return 0;
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  const substring = value.indexOf(query); if (substring >= 0) return 2 + substring;
  let at = 0, score = 100;
  for (const char of query) {
    const found = value.indexOf(char, at); if (found < 0) return Infinity;
    score += found - at; at = found + 1;
  }
  return score;
}
function pathQuery(value) {
  value = value.trim();
  if (value === "~") value = "~/";
  if (!value.startsWith("/") && !value.startsWith("~/")) return null;
  const slash = value.lastIndexOf("/"), parent = value.slice(0, slash + 1);
  return { parent, folder: parent.startsWith("~/") ? home() + parent.slice(1) : parent, query: value.slice(slash + 1) };
}
function projectScore(project, query) {
  if (query.startsWith("/") || query.startsWith("~/") || query === "~") {
    if (query.startsWith("~")) {
      if (project.machine != null) return Infinity;
      query = home() + query.slice(1);
    }
    const parts = query.split("/").filter(Boolean), path = project.root.split("/").filter(Boolean);
    if (parts.length > path.length) return Infinity;
    let score = 0;
    for (let i = 0; i < parts.length; i++) score += fuzzyScore(path[i], parts[i]);
    return score;
  }
  return fuzzyScore(`${project.machine ?? "local"} ${project.root}`, query);
}
function directoryRows(paths, query) {
  return paths.map(path => ({path, score:fuzzyScore(path.slice(path.lastIndexOf("/") + 1), query)}))
    .filter(row => Number.isFinite(row.score)).sort((a,b) => a.score - b.score || a.path.localeCompare(b.path)).map(row => row.path);
}
let docsKey = "docs", linkKey = "task-doc-link", docsDir = () => `${home()}/mydesk/tasks`, allowedDoc = path => Boolean(path), checkDoc = async () => {};

export default class TaskTree extends View {
  init(_props, cx) {
    this.folded = load("folded"); this.last = load("last"); this.assignments = load("assignments"); this.docs = load(docsKey); this.roots = {}; this.pending = {}; this.labelled = {};
    this.persistGroups = true; this.selectedGroup = null; this.groupOwner = Math.random();
    if (props()?.projectPicker) {
      this.filter = InputState.new({ placeholder: "Project or ~/path" });
      this.handle = cx.focus_handle(); this.choiceScroll = VirtualListScrollHandle.new(); this.directoryCache = {}; this.directoryPending = {}; this.selectedChoice = null;
      this.filter.on("change", (_e, cx) => {
        if (this.completion?.value !== this.filter.value()) { this.completion = null; this.selectedChoice = null; this.choiceScroll.scroll_to_item(0); }
        this.error = null; this.completeRequested = null; this.loadDirectories(cx); cx.notify();
      });
      this.filter.on("submit", (_e, cx) => this.chooseFirst(cx));
      cx.bind_keys([
        {keystroke:"tab", action:"task-project-complete", context:"TaskProjectPicker"},
        {keystroke:"shift-tab", action:"task-project-prev", context:"TaskProjectPicker"},
        {keystroke:"down", action:"task-project-next", context:"TaskProjectPicker"},
        {keystroke:"up", action:"task-project-prev", context:"TaskProjectPicker"},
        {keystroke:"escape", action:"task-project-close", context:"TaskProjectPicker"},
      ]);
      this.filter.focus();
      return;
    }
    if (props()?.taskMenu || props()?.projectMenu) return;
    if (props()?.chooser) {
      this.title = InputState.new({ value: props().title }); this.filter = InputState.new({ placeholder: "Filter existing documents" });
      this.title.on("change", (_e, cx) => cx.notify()); this.filter.on("change", (_e, cx) => cx.notify());
      this.listDocs(cx);
      return;
    }
    if (!props()?.header) cx.spawn(async cx => {
      for (;;) { const command = await nextCommand(); this.command(command, cx); cx.notify(); }
    });
  }
  groups() {
    if (!this.persistGroups) return groupSpaces(spaces(), this.assignments);
    const update = shared("task-project-update");
    if (update && update !== this.projectUpdate) { this.projectUpdate = update; this.assignments = load("assignments"); }
    const state = savedGroups(this.assignments), live = spaces().map(space => this.assignments[space.id]).filter(Boolean);
    const reopened = new Set(live.map(project => key(project.machine, project.root)));
    state.removed = state.removed.filter(id => !reopened.has(id));
    state.projects = history([...state.projects, ...live], {});
    storeGroups(state);
    return groupSpaces(spaces(), this.assignments, state.projects, machines());
  }
  currentGroup(groups) {
    const current = spaces().find(space => space.active), active = groups.find(group => group.tasks.some(task => task.id === current?.id));
    if (this.activeSpace !== current?.id) { this.activeSpace = current?.id; this.selectedGroup = active?.id ?? null; this.followActive = true; }
    if (this.followActive && active) this.selectedGroup = active.id;
    const selected = groups.find(group => group.id === this.selectedGroup) ?? active ?? groups[0];
    this.selectedGroup = selected?.id ?? null;
    return selected;
  }
  remember(assignment, previous = null) {
    const state = savedGroups(this.assignments), saved = load("project-history");
    const list = history([assignment, previous, ...(Array.isArray(saved) ? saved : [])], this.assignments);
    localStorage.setItem("project-history", JSON.stringify(list));
    const added = history([assignment, previous], {}).filter(project => !state.removed.includes(key(project.machine, project.root)));
    state.projects = history([...state.projects, ...added], {}); storeGroups(state);
  }
  removeGroup(id) {
    const group = this.groups().find(group => group.id === id);
    if (!group || group.fallback || group.tasks.length) return false;
    const state = savedGroups(this.assignments);
    state.projects = state.projects.filter(project => key(project.machine, project.root) !== id);
    if (!state.removed.includes(id)) state.removed.push(id);
    storeGroups(state); if (this.selectedGroup === id) this.selectedGroup = null;
    return true;
  }
  savePin(id, assignment) {
    this.assignments = load("assignments");
    if (pin(this.assignments, id, assignment)) {
      localStorage.setItem("assignments", JSON.stringify(this.assignments)); this.remember(assignment);
      setShared("task-project-update", Math.random());
    }
  }
  close() { this.closed = true; }
  resolve(list, all, cx) {
    if (this.creating) return;
    for (const space of list) {
      if (this.assignments[space.id] || this.pending[space.id] || machines().find(m => m.name === (space.machine ?? null))?.layout !== "ready") continue;
      const terminal = firstTerminal(space, all);
      if (!terminal && (!space.tabs.length || !space.tabs.every(tab => Number.isInteger(tab.panes) && tab.panes > 0 && all.filter(p => p.tab === tab.id).length === tab.panes))) continue;
      const folder = terminal?.cwd || space.folder || (space.machine == null ? home() : ""), k = key(space.machine, folder);
      this.pending[space.id] = true;
      cx.spawn(async cx => {
        let root = this.roots[k];
        if (root === undefined) {
          root = folder;
          if (folder) for (const [command, args] of [["jj", ["root"]], ["git", ["rev-parse", "--show-toplevel"]]]) {
            try { const result = await exec(command, args, { cwd: folder, on: space.machine }); if (result.code === 0 && result.stdout.trim()) { root = result.stdout.trim(); break; } } catch { /* Try the next lookup. */ }
          }
          this.roots[k] = root;
        }
        this.savePin(space.id, { machine: space.machine ?? null, root }); delete this.pending[space.id]; cx.notify();
      });
    }
  }
  select(group, task) {
    if (!group) return;
    this.currentGroup(this.groups()); this.selectedGroup = group.id; this.followActive = false;
    if (!task) return;
    this.folded[group.id] = false; this.last[group.id] = task.id;
    localStorage.setItem("folded", JSON.stringify(this.folded)); localStorage.setItem("last", JSON.stringify(this.last));
    if (!task.active) run("space.select", { id: task.id });
  }
  command(command, cx) {
    if (command.startsWith("artifact:")) {
      try {
        const {terminal, path, title} = JSON.parse(command.slice(9));
        if (typeof terminal === "string" && terminal.includes("/")) { console.log("Cannot register artifacts from remote terminals"); return; }
        const space = artifactSpace(terminal, panes(), spaces(), terminals());
        if (!space || typeof path !== "string" || !path.startsWith("/") || typeof title !== "string") throw new Error("Invalid terminal or artifact");
        const all = shared(artifactKey) ?? {};
        setShared(artifactKey, {...all, [space]: addArtifact(all[space] ?? [], path, title)});
      } catch (e) { console.log(`Could not register artifact: ${e}`); }
      return;
    }
    const groups = this.groups(), current = spaces().find(s => s.active);
    const group = this.currentGroup(groups);
    if (command === "new") { if (group) this.newTask(group, cx); return; }
    if (command === "open-project") { this.openProjects(); return; }
    if (command === "notes") { if (current) this.notes(current, docsDir()); return; }
    if (command === "next" || command === "prev") {
      const target = step(groups.flatMap(g => g.tasks), current?.id, command === "next" ? 1 : -1);
      this.select(groups.find(g => g.tasks.includes(target)), target); return;
    }
    const taskMatch = /^task:([1-9])$/.exec(command);
    if (taskMatch) { this.select(group, nth(group?.tasks ?? [], Number(taskMatch[1]))); return; }
    let target;
    if (command === "project-next" || command === "project-prev") target = step(groups, group?.id, command === "project-next" ? 1 : -1);
    else { const match = /^project:([1-9])$/.exec(command); if (match) target = nth(groups, Number(match[1])); }
    if (target) this.select(target, target.tasks.find(s => s.id === this.last[target.id]) ?? target.tasks[0]);
  }
  openProjects(task = null) { openOverlay({mod:"task-tree", kind:"dialog", width:520, height:420, props:{projectPicker:true, task}}); }
  projectRows() {
    const saved = load("project-history"), all = history(Array.isArray(saved) ? saved : [], load("assignments"));
    const filter = this.filter.value().trim();
    return all.map(project => ({project, score:projectScore(project, filter)})).filter(row => Number.isFinite(row.score))
      .sort((a,b) => a.score - b.score).map(row => row.project);
  }
  folderRows() {
    const query = pathQuery(this.filter.value());
    return query ? directoryRows(this.directoryCache?.[query.folder] ?? [], query.query) : [];
  }
  projectChoices() {
    if (this.completion?.value === this.filter.value()) return this.completion.rows;
    const folders = this.folderRows();
    return [...folders.map(path => ({id:`project:${key(null,path)}`, path})), ...this.projectRows()
      .filter(p => p.machine != null || !folders.includes(p.root)).map(project => ({id:`project:${key(project.machine,project.root)}`, project}))];
  }
  loadDirectories(cx) {
    const query = pathQuery(this.filter.value()); this.directoryError = null;
    if (!query || this.directoryCache[query.folder] || this.directoryPending[query.folder]) return;
    this.directoryPending[query.folder] = true;
    cx.spawn(async cx => {
      try {
        const result = await exec("sh", ["-c", 'test -d "$1" || exit 1; for dir in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -d "$dir" ] && printf "%s\\0" "$dir"; done; exit 0', "directories", query.folder], {timeout:5000});
        if (result.code) throw new Error(result.stderr || "Cannot list this folder; complete its parent first");
        const paths = result.stdout.split("\0").filter(Boolean).map(path => path.replace(/\/+/g, "/").replace(/\/$/, ""));
        if (this.closed) return;
        this.directoryCache[query.folder] = paths;
      } catch (e) {
        if (!this.closed && pathQuery(this.filter.value())?.folder === query.folder) this.directoryError = String(e);
      } finally {
        delete this.directoryPending[query.folder];
        if (!this.closed) {
          if (this.completeRequested === this.filter.value() && pathQuery(this.filter.value())?.folder === query.folder) { this.completeRequested = null; this.completePath(cx); }
          const index = this.projectChoices().findIndex(row => row.id === this.selectedChoice);
          if (index >= 0) this.choiceScroll.scroll_to_item(index, "center");
          cx.notify();
        }
      }
    });
  }
  fillPath(path, cx, completion = null) {
    const value = this.filter.value().trim(), base = home();
    const next = (value.startsWith("~") && (path === base || path.startsWith(base + "/")) ? "~" + path.slice(base.length) : path) + "/";
    // Set the expected value before set_value: change events must not discard our candidate snapshot.
    this.completion = completion ? {...completion, value:next} : null;
    this.selectedChoice = completion ? completion.choices[completion.index].id : null;
    this.completeRequested = null; this.error = null; this.filter.set_value(next);
    if (completion) this.choiceScroll.scroll_to_item(completion.rows.findIndex(row => row.id === this.selectedChoice), "center");
    this.loadDirectories(cx); this.filter.focus(); cx.notify();
  }
  completePath(cx) {
    const rows = this.projectChoices(), selected = rows.find(row => row.id === this.selectedChoice);
    if (selected?.project?.machine != null) return;
    let completion = this.completion;
    if (completion?.value === this.filter.value()) completion = {...completion, index:completion.restart ? completion.index : (completion.index + 1) % completion.choices.length, restart:false};
    else {
      const query = pathQuery(this.filter.value());
      if (!selected && query && this.directoryPending[query.folder]) { this.completeRequested = this.filter.value(); return; }
      const choices = rows.filter(row => row.path || row.project.machine == null);
      if (!choices.length) return;
      completion = {rows, choices, index:Math.max(0, choices.findIndex(row => row.id === this.selectedChoice))};
    }
    const row = completion.choices[completion.index];
    this.fillPath(row.path ?? row.project.root, cx, completion);
  }
  pickerAction(action, cx) {
    cx.stop_propagation();
    if (action === "task-project-close") {
      this.completeRequested = null; this.completion = null; this.close(); closeOverlay(props().overlay); return;
    }
    if (action === "task-project-complete") this.completePath(cx);
    else if (action === "task-project-next" || action === "task-project-prev") {
      const rows = this.projectChoices(), selected = step(rows, this.selectedChoice, action === "task-project-next" ? 1 : -1);
      this.completeRequested = null; this.selectedChoice = selected?.id ?? null;
      if (selected) {
        if (this.completion) this.completion = {...this.completion, index:this.completion.choices.findIndex(row => row.id === selected.id), restart:true};
        this.choiceScroll.scroll_to_item(rows.indexOf(selected), "center");
      }
    }
    this.filter.focus(); cx.notify();
  }
  chooseFirst(cx) {
    const selected = this.projectChoices().find(row => row.id === this.selectedChoice);
    if (selected?.path) { this.choosePath(selected.path, cx); return; }
    if (selected?.project) { this.chooseProject(selected.project, cx); return; }
    const value = this.filter.value().trim();
    if (value.startsWith("/") || value.startsWith("~")) this.choosePath(value, cx);
    else { const first = this.projectRows()[0]; if (first) this.chooseProject(first, cx); }
  }
  choosePath(value, cx) {
    if (this.picking) return;
    const folder = value === "~" ? home() : value.startsWith("~/") ? home() + value.slice(1) : value;
    if (!folder.startsWith("/")) { this.error = "Enter an absolute path or ~/ path"; cx.notify(); return; }
    this.picking = true;
    cx.spawn(async cx => {
      try {
        const valid = await exec("sh", ["-c", 'test -d "$1"', "folder", folder]);
        if (valid.code) throw new Error("Folder does not exist");
        let jj = "", git = "";
        try { const r = await exec("jj", ["root"], {cwd:folder}); if (!r.code) jj = r.stdout; } catch {}
        if (!jj.trim()) try { const r = await exec("git", ["rev-parse", "--show-toplevel"], {cwd:folder}); if (!r.code) git = r.stdout; } catch {}
        if (this.closed) return;
        this.picking = false; this.chooseProject({machine:null, root:repoRoot(folder, jj, git)}, cx);
      } catch (e) { this.error = String(e); this.picking = false; cx.notify(); }
    });
  }
  chooseProject(project, cx) {
    if (this.picking) return; this.completion = null; this.completeRequested = null; this.picking = true;
    cx.spawn(async cx => {
      try {
        if (this.closed) return;
        let assignments = load("assignments"), previous = null;
        if (props().task) {
          previous = assignments[props().task]; movePin(assignments, props().task, project);
          localStorage.setItem("assignments", JSON.stringify(assignments));
        } else {
          const r = await exec("herdr-app", ["do", "space.new", JSON.stringify({folder:project.root, machine:project.machine ?? ""})]);
          if (r.code) throw new Error(r.stderr || r.stdout);
          const made = JSON.parse(r.stdout); if (!made.space) throw new Error("space.new did not return a space");
          assignments = load("assignments"); assignments[made.space] = project;
          localStorage.setItem("assignments", JSON.stringify(assignments));
          run("space.select", {id:made.space});
        }
        this.assignments = assignments; this.remember(project, previous); setShared("task-project-update", Math.random()); closeOverlay(props().overlay);
      } catch (e) { this.error = String(e); this.picking = false; cx.notify(); }
    });
  }
  projectPicker() {
    const t = theme(), value = this.filter.value().trim();
    const button = (id, label, action) => div().id(id).px(8).py(7).rounded(5).cursor_pointer().when(this.selectedChoice === id, el => el.bg(t.selected)).hover(s => s.bg(t.hover)).when(Boolean(action), el => el.on_click(action)).child(label);
    const query = pathQuery(value), choices = this.projectChoices(), base = home();
    const displayPath = path => path === base ? "~" : path.startsWith(base + "/") ? "~" + path.slice(base.length) : path;
    const choice = row => button(row.id, row.path ? `${displayPath(row.path)}/` : row.project.machine == null
      ? displayPath(row.project.root) : `${row.project.machine}: ${row.project.root}`)
      .whitespace_nowrap().text_ellipsis_middle().tooltip(row.path ?? (row.project.machine == null ? row.project.root : `${row.project.machine}: ${row.project.root}`));
    return v_flex().id("project-picker").track_focus(this.handle).key_context("TaskProjectPicker")
      .on_action("task-project-complete", (_e,cx) => this.pickerAction("task-project-complete",cx))
      .on_action("task-project-next", (_e,cx) => this.pickerAction("task-project-next",cx))
      .on_action("task-project-prev", (_e,cx) => this.pickerAction("task-project-prev",cx))
      .on_action("task-project-close", (_e,cx) => this.pickerAction("task-project-close",cx))
      .size_full().min_h(0).p(14).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child(props().task ? "Move to project" : "Open project"))
        .child(button("project-close", "×", (_e,cx) => this.pickerAction("task-project-close",cx)).px(6).py(2).text_size(16).text_color(t.dim).tooltip("Close (Esc)")))
      .child(Input.new(this.filter).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).whitespace_nowrap().text_ellipsis().tooltip(this.error).child(this.error)))
      .child(div().relative().flex_1().min_h(0)
        .child(v_virtual_list("project-choices", choices.length, 34, i => choices[i].id,
          range => choices.slice(range.start, range.end).map(row => choice(row).h(34).overflow_hidden())).size_full().track_scroll(this.choiceScroll)
          .on_item_click((id,cx) => {
            const row = this.projectChoices().find(row => row.id === id); if (!row) return;
            if (row.path) this.fillPath(row.path,cx); else this.chooseProject(row.project,cx);
          }))
        .child(Scrollbar.vertical("project-choices").absolute().inset_0())
        .when(choices.length === 0, el => el.child(v_flex().absolute().inset_0().p(8).items_center().justify_center().text_color(t.dim)
          .child(this.directoryError || (query && this.directoryPending?.[query.folder] ? "Loading folders…" : value ? "No matches" : "")))))
      .when(value.startsWith("/") || value.startsWith("~"), el => el.child(h_flex().gap(8).justify_end()
        .when(Boolean(this.directoryError && choices.length), row => row.child(div().id("project-directory-error").flex_1().min_w(0).text_size(11).text_color(t.blocked)
          .whitespace_nowrap().text_ellipsis().tooltip(this.directoryError).child(this.directoryError)))
        .when(Boolean(query), row => row.child(button("project-complete", "⇥", (_e,cx) => this.pickerAction("task-project-complete",cx)).py(4).text_color(t.dim).tooltip("Complete / cycle matches (Tab)")))
        .child(button("project-path", "Open", (_e,cx) => this.chooseFirst(cx)).py(4).font_semibold().text_color(t.accent).tooltip("Open (Enter)"))));
  }
  projectMenu() {
    const t = theme(), removable = props().removable === true;
    return v_flex().p(6).bg(t.popover).text_color(t.foreground)
      .child(div().id("remove-group").px(8).py(7).text_color(removable ? t.foreground : t.dim)
        .tooltip(removable ? "Remove this empty group from the sidebar" : "Close or move its tasks before removing the group")
        .when(removable, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
        .on_click(() => {
          if (!removable) return;
          setShared("task-project-remove", {group:props().group, owner:props().owner, request:Math.random()});
          closeOverlay(props().overlay);
        }).child("Remove group"));
  }
  taskMenu() {
    const t = theme(); return v_flex().p(6).bg(t.popover).text_color(t.foreground).child(div().id("move-project").px(8).py(7).cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => { closeOverlay(props().overlay); this.openProjects(props().task); }).child("Move to project…"))
      .child(div().id("space-menu").px(8).py(7).cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => { closeOverlay(props().overlay); openOverlay({mod:"menu", kind:"popup", width:200, props:{tab:"space", target:{id:props().task}}}); }).child("More actions…"));
  }
  notes(space, dir) {
    if (dir !== docsDir()) { notify({ title: "Invalid task notes directory", body: dir, level: "error" }); return; }
    const path = this.docs[space.id];
    if (path && !allowedDoc(path)) { notify({ title: "Invalid task notes path", body: path, level: "error" }); return; }
    if (path) {
      let existing = panes().find(p => p.mod === "task-doc" && space.tabs.some(t => t.id === p.tab));
      if (!space.active) run("space.select", { id: space.id });
      if (existing) run("tab.select", { id: existing.tab });
      else run("tab.new", { space: space.id, name: "notes", mod: "task-doc", props: { path } });
    } else openOverlay({ mod: "task-tree", kind: "dialog", width: 460, height: 480, props: { chooser: true, space: space.id, title: taskTitle(space, taskAgent(space, agents())), dir } });
  }
  listDocs(cx) {
    if (props().dir !== docsDir()) { this.error = "Invalid document directory"; return; }
    cx.spawn(async cx => {
      try {
        await checkDoc(null);
        const script = 'test -d "$1" || exit 1; find "$1" -maxdepth 1 -type f -name "*.md" -print0 | xargs -0 stat -f "%m %N" 2>/dev/null | sort -rn';
        const result = await exec("sh", ["-c", script, "task-docs", props().dir]);
        if (result.code) throw new Error(result.stderr || "Cannot list documents");
        this.files = result.stdout.split("\n").filter(Boolean).map(line => line.slice(line.indexOf(" ") + 1)); this.error = null;
      } catch (e) { this.error = String(e); }
      cx.notify();
    });
  }
  link(path) {
    if (!allowedDoc(path)) { this.error = "Invalid document path"; return; }
    setShared(linkKey, { space: props().space, path });
    closeOverlay(props().overlay);
    run("tab.new", { space: props().space, name: "notes", mod: "task-doc", props: { path } });
  }
  createDoc(cx) {
    const title = this.title.value().trim(); if (!title || this.creatingDoc) return;
    const path = `${props().dir}/${slugify(title)}.md`;
    if (props().dir !== docsDir() || !allowedDoc(path)) { this.error = "Invalid document path"; return; }
    this.creatingDoc = true;
    cx.spawn(async cx => {
      try {
        await checkDoc(path); const current = await readTextFile(path);
        if (current !== null) { this.existing = path; this.error = "File already exists; link it instead."; return; }
        const date = new Date(), local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        let owner = "";
        try { const result = await exec("git", ["config", "user.email"]); if (result.code === 0) owner = result.stdout.trim(); } catch { /* Leave the owner empty when Git is unavailable. */ }
        await checkDoc(path); await writeTextFile(path, template(title, local, owner), null); this.link(path);
      } catch (e) { this.error = String(e); try { await checkDoc(path); this.existing = (await readTextFile(path)) !== null ? path : null; } catch { this.existing = null; } }
      finally { this.creatingDoc = false; cx.notify(); }
    });
  }
  chooser() {
    const t = theme(), button = (id, text, action) => div().id(id).px(8).py(6).rounded(5).cursor_pointer().bg(t.raised).hover(s => s.bg(t.hover)).on_click(action).child(text);
    const input = state => Input.new(state).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background);
    return v_flex().size_full().min_h(0).p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().child("Task notes"))
      .child(input(this.title)).child(button("new-doc", "New doc", (_e, cx) => this.createDoc(cx)))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .when(Boolean(this.existing), el => el.child(button("link-collision", `Link ${this.existing.split("/").pop()}`, () => this.link(this.existing))))
      .child(div().pt(8).child("Link existing")) .child(input(this.filter))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children((this.files ?? []).filter(p => p.toLowerCase().includes(this.filter.value().toLowerCase())).map(p => button(`file-${p}`, p.split("/").pop(), () => this.link(p)))))
      .child(button("cancel", "Cancel", () => closeOverlay(props().overlay)));
  }
  labelDocs(list, all, cx) {
    for (const space of list) {
      const path = this.docs[space.id]; if (!path || !allowedDoc(path)) continue;
      for (const pane of all.filter(p => p.terminal && space.tabs.some(t => t.id === p.tab))) {
        if (this.labelled[pane.terminal] === path) continue;
        this.labelled[pane.terminal] = path;
        cx.spawn(async cx => { try { const r = await exec("hc", ["label", pane.terminal, `task.doc=${path}`]); if (r.code) throw new Error(r.stderr || r.stdout); } catch (e) { delete this.labelled[pane.terminal]; notify({ title: "Could not label terminal", body: String(e), level: "error" }); } });
      }
    }
  }
  newTask(group, cx) {
    if (this.creating || machines().find(m => m.name === (group.machine ?? null))?.layout !== "ready") return;
    this.creating = true;
    cx.spawn(async cx => {
      try {
        const result = await exec("herdr-app", ["do", "space.new", JSON.stringify({ ...(group.fallback ? {} : {folder:group.root}), machine: group.machine ?? "" })]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
        const made = JSON.parse(result.stdout); if (!made.space) throw new Error("space.new did not return a space");
        if (!group.fallback) this.savePin(made.space, { machine: group.machine ?? null, root: group.root });
        this.select(group, { id: made.space });
      } catch (error) { notify({ title: "Could not create task", body: String(error), level: "error" }); }
      finally { this.creating = false; cx.notify(); }
    });
  }
  status(status, t) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked" || status === "done") return div().size(7).flex_none().rounded_full().bg(t[status]);
    return div().w(7).flex_none();
  }
  row(group, space, all, t) {
    const firstAgent = taskAgent(space, all);
    const title = taskTitle(space, firstAgent);
    const agent = firstAgent?.program?.icon ? firstAgent : null;
    return h_flex().id(`task-${space.id}`).h(29).flex_none().min_w(0).pl(27).pr(6).gap(6).items_center().rounded(6)
      .bg(space.active ? t.selected : t.chrome).hover(s => s.bg(t.hover)).cursor_pointer()
      .on_click(() => this.select(group, space))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "task-tree", kind: "popup", width: 200, height: 90, props: { taskMenu: true, task: space.id } }); })
      .child(this.status(space.status, t))
      .when(Boolean(agent), el => el.child(agent.program.tint ? svg(agent.program.icon).size(14).flex_none().text_color(t.muted) : image(agent.program.icon).size(14).flex_none()))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(title).child(title))
      .child(div().id(`notes-${space.id}`).px(4).text_color(t.dim).tooltip(this.docs[space.id] ? "Open task notes" : "Add task notes").on_click((_e, cx) => { cx.stop_propagation(); this.notes(space, docsDir()); }).child(this.docs[space.id] ? "📄" : "+"))
      .when(space.tabs.length > 1, el => el.child(div().flex_none().text_color(t.dim).tooltip(`${space.tabs.length} tabs`).child(`${space.tabs.length}`)));
  }
  project(group, all, t, cx) {
    const folded = Boolean(this.folded[group.id]);
    const name = group.root.replace(/\/+$/, "").split("/").pop() || group.root || "~";
    const label = group.fallback ? group.machine ?? "Local" : `${group.machine ? `${group.machine}: ` : ""}${name}`;
    const available = machines().find(m => m.name === group.machine)?.layout === "ready";
    return v_flex().min_w(0).flex_none().pt(8)
      .child(h_flex().id(`project-${group.id}`).h(25).min_w(0).gap(5).px(6).items_center().text_size(10.5).text_color(t.muted)
        .when(this.selectedGroup === group.id, el => el.bg(t.selected)).cursor_pointer()
        .on_click((_e, cx) => { this.select(group, group.tasks.find(task => task.id === this.last[group.id]) ?? group.tasks[0]); cx.notify(); })
        .when(!group.fallback, el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({mod:"task-tree", kind:"popup", width:200, height:50, props:{projectMenu:true, group:group.id, owner:this.groupOwner, removable:!group.tasks.length}}); }))
        .on_hover((hovered, cx) => { if (hovered) this.hoveredProject = group.id; else if (this.hoveredProject === group.id) this.hoveredProject = null; cx.notify(); })
        .child(div().id(`fold-${group.id}`).size(20).flex_none().flex().items_center().justify_center().cursor_pointer().tooltip(folded ? "Expand project" : "Collapse project")
          .on_click((_e, cx) => { cx.stop_propagation(); this.folded[group.id] = !folded; localStorage.setItem("folded", JSON.stringify(this.folded)); cx.notify(); }).child(folded ? "›" : "⌄"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().tooltip(group.fallback ? "New task at this machine's default directory" : group.machine ? `${group.machine}: ${group.root}` : group.root).child(label))
        .child(div().flex_none().text_color(t.dim).tooltip(`${group.tasks.length} tasks`).child(`${group.tasks.length}`))
        .child(div().id(`new-${group.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted).hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip(available ? "New task in this project" : "Machine unavailable")
          .on_click((_e, cx) => { cx.stop_propagation(); if (available) this.newTask(group, cx); }).child(this.hoveredProject === group.id ? "+" : "")))
      .when(!folded, el => el.children(group.tasks.map(s => this.row(group, s, all, t))));
  }
  render(cx) {
    if (props()?.projectPicker) return this.projectPicker();
    if (props()?.taskMenu) return this.taskMenu();
    if (props()?.projectMenu) return this.projectMenu();
    if (props()?.chooser) return this.chooser();
    const update = shared("task-project-update"); if (update && update !== this.projectUpdate) { this.projectUpdate = update; this.assignments = load("assignments"); }
    if (props()?.header) { const t = theme(); return h_flex().size_full().items_center().pl(window()?.platform === "macos" && !window()?.fullscreen ? 76 : 14).text_color(t.foreground).font_semibold().child("Herdr"); }
    const t = theme(), all = agents(), list = spaces(), current = list.find(s => s.active);
    const link = shared(linkKey);
    if (link?.space && allowedDoc(link.path) && this.docs[link.space] !== link.path) { this.docs[link.space] = link.path; localStorage.setItem(docsKey, JSON.stringify(this.docs)); }
    const allPanes = panes(); this.resolve(list, allPanes, cx); this.labelDocs(list, allPanes, cx);
    // Popup copies have separate localStorage; only the owning sidebar may remove its saved group.
    const removal = shared("task-project-remove");
    if (removal?.owner === this.groupOwner && removal.request !== this.groupRemoval) {
      this.groupRemoval = removal.request; this.removeGroup(removal.group);
    }
    const groups = this.groups(), group = groups.find(g => g.tasks.some(s => s.active));
    this.currentGroup(groups);
    if (group && this.last[group.id] !== current.id) { this.last[group.id] = current.id; localStorage.setItem("last", JSON.stringify(this.last)); }
    const tool = (id, label, action, icon = null) => h_flex().id(id).h(27).px(8).items_center().rounded(6).cursor_pointer()
      .when(Boolean(icon), el => el.gap(6).child(svg(icon).size(14).flex_none().text_color(t.muted)))
      .text_size(12.5).bg(t.chrome).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(12.5)
      .child(h_flex().h(32).px(12).items_center().justify_between().text_color(t.dim).child("Projects")
        .child(div().id("workspace-create").size(24).flex().items_center().justify_center().rounded(6).tooltip("Open project").hover(s => s.bg(t.hover)).on_click(() => this.openProjects()).child("+")))
      .child(v_flex().flex_1().min_h(0).px(6).overflow_y_scrollbar().children(groups.map(g => this.project(g, all, t, cx))))
      .child(v_flex().border_t(1).border_color(t.border).p(6)
        .child(tool("settings-tool", "Settings", () => run("app.settings"), "mods/workspace-chrome/settings.svg"))
        .child(tool("palette-tool", "Command palette", () => run("app.palette"))));
  }
}
