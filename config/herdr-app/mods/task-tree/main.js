import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, panes, agents, terminals, machines, theme, run, openOverlay, closeOverlay, window, props, home, nextCommand, exec, notify, readTextFile, writeTextFile, shared, setShared } from "herdr";
import { slugify, template } from "./doc-logic.js";
import { artifactKey, addArtifact, artifactSpace } from "./artifact-logic.js";

function key(machine, folder) { return JSON.stringify([machine ?? null, folder]); }
function groupSpaces(list, assignments) {
  const groups = [], byKey = {};
  for (const space of list) {
    const assignment = assignments[space.id];
    if (!assignment) continue;
    const { machine, root } = assignment, id = key(machine, root);
    if (!byKey[id]) { byKey[id] = { id, root, machine, tasks: [] }; groups.push(byKey[id]); }
    byKey[id].tasks.push(space);
  }
  return groups;
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
function repoRoot(folder, jj, git) { return jj?.trim() || git?.trim() || folder; }
function movePin(assignments, id, assignment) { assignments[id] = assignment; }
let docsKey = "docs", linkKey = "task-doc-link", docsDir = () => `${home()}/mydesk/tasks`, allowedDoc = path => Boolean(path), checkDoc = async () => {};

export default class TaskTree extends View {
  init(_props, cx) {
    this.folded = load("folded"); this.last = load("last"); this.assignments = load("assignments"); this.docs = load(docsKey); this.roots = {}; this.pending = {}; this.labelled = {};
    if (props()?.projectPicker) {
      this.filter = InputState.new({ placeholder: "Filter projects or enter a path" });
      this.filter.on("change", (_e, cx) => cx.notify());
      this.filter.on("submit", (_e, cx) => this.chooseFirst(cx)); this.filter.focus();
      return;
    }
    if (props()?.taskMenu) return;
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
  groups() { return groupSpaces(spaces(), this.assignments); }
  remember(assignment, previous = null) {
    const saved = load("project-history");
    const list = history([assignment, previous, ...(Array.isArray(saved) ? saved : [])], this.assignments);
    localStorage.setItem("project-history", JSON.stringify(list));
  }
  savePin(id, assignment) {
    this.assignments = load("assignments");
    if (pin(this.assignments, id, assignment)) { localStorage.setItem("assignments", JSON.stringify(this.assignments)); this.remember(assignment); }
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
    if (!group || !task) return;
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
    const group = groups.find(g => g.tasks.some(s => s.id === current?.id));
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
    const filter = this.filter.value().trim().toLowerCase();
    return all.filter(p => `${p.machine ?? "local"} ${p.root}`.toLowerCase().includes(filter));
  }
  chooseFirst(cx) {
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
    if (this.picking) return; this.picking = true;
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
    const button = (id, label, action) => div().id(id).px(8).py(7).rounded(5).cursor_pointer().hover(s => s.bg(t.hover)).on_click(action).child(label);
    return v_flex().size_full().min_h(0).p(14).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().child(props().task ? "Move to project" : "Open project"))
      .child(Input.new(this.filter).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(this.projectRows().map(p => button(`project-choice-${key(p.machine,p.root)}`, `${p.machine ?? "local"}: ${p.root}`, (_e,cx) => this.chooseProject(p,cx)))))
      .when(value.startsWith("/") || value.startsWith("~"), el => el.child(button("project-path", `Open folder: ${value}`, (_e,cx) => this.choosePath(value,cx))));
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
        const result = await exec("herdr-app", ["do", "space.new", JSON.stringify({ folder: group.root, machine: group.machine ?? "" })]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
        const made = JSON.parse(result.stdout); if (!made.space) throw new Error("space.new did not return a space");
        this.savePin(made.space, { machine: group.machine ?? null, root: group.root });
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
    const name = group.root.replace(/\/+$/, "").split("/").pop() || group.root || group.machine || "~";
    const label = `${group.machine ? `${group.machine}: ` : ""}${name.toUpperCase()}`;
    const available = machines().find(m => m.name === group.machine)?.layout === "ready";
    return v_flex().min_w(0).flex_none().pt(8)
      .child(h_flex().id(`project-${group.id}`).h(25).min_w(0).gap(5).px(6).items_center().text_size(10.5).text_color(t.muted)
        .on_hover((hovered, cx) => { if (hovered) this.hoveredProject = group.id; else if (this.hoveredProject === group.id) this.hoveredProject = null; cx.notify(); })
        .child(div().id(`fold-${group.id}`).size(20).flex_none().flex().items_center().justify_center().cursor_pointer().tooltip(folded ? "Expand project" : "Collapse project")
          .on_click((_e, cx) => { cx.stop_propagation(); this.folded[group.id] = !folded; localStorage.setItem("folded", JSON.stringify(this.folded)); cx.notify(); }).child(folded ? "›" : "⌄"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().tooltip(group.machine ? `${group.machine}: ${group.root}` : group.root).child(label))
        .child(div().flex_none().text_color(t.dim).tooltip(`${group.tasks.length} tasks`).child(`${group.tasks.length}`))
        .child(div().id(`new-${group.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted).hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip(available ? "New task in this project" : "Machine unavailable")
          .on_click((_e, cx) => { cx.stop_propagation(); if (available) this.newTask(group, cx); }).child(this.hoveredProject === group.id ? "+" : "")))
      .when(!folded, el => el.children(group.tasks.map(s => this.row(group, s, all, t))));
  }
  render(cx) {
    if (props()?.projectPicker) return this.projectPicker();
    if (props()?.taskMenu) return this.taskMenu();
    if (props()?.chooser) return this.chooser();
    const update = shared("task-project-update"); if (update && update !== this.projectUpdate) { this.projectUpdate = update; this.assignments = load("assignments"); }
    if (props()?.header) { const t = theme(); return h_flex().size_full().items_center().pl(window()?.platform === "macos" && !window()?.fullscreen ? 76 : 14).text_color(t.foreground).font_semibold().child("Herdr"); }
    const t = theme(), all = agents(), list = spaces(), current = list.find(s => s.active);
    const link = shared(linkKey);
    if (link?.space && allowedDoc(link.path) && this.docs[link.space] !== link.path) { this.docs[link.space] = link.path; localStorage.setItem(docsKey, JSON.stringify(this.docs)); }
    const allPanes = panes(); this.resolve(list, allPanes, cx); this.labelDocs(list, allPanes, cx);
    const groups = this.groups(), group = groups.find(g => g.tasks.some(s => s.active));
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
