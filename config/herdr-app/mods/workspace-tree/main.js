import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, machines, theme, run, openOverlay, layout, window, props } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}

export default class WorkspaceTree extends View {
  init() {
    this.folded = load("folded");
    this.representatives = load("representatives");
    this.panels = load("panels");
  }

  representative(tab, all) {
    const candidates = all.filter(p => p.tab === tab.id && p.terminal);
    let pane = candidates.find(p => p.terminal === this.representatives[tab.id]);
    if (!pane && candidates.length) {
      pane = candidates.find(p => p.program?.agent) ?? candidates[0];
      this.representatives[tab.id] = pane.terminal;
      localStorage.setItem("representatives", JSON.stringify(this.representatives));
    }
    return pane;
  }

  status(status, t) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked" || status === "done") return div().size(7).flex_none().rounded_full().bg(t[status]);
    return div().w(7).flex_none();
  }

  togglePanel(id) {
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    const on = panel && !panel.hidden && body?.active === id;
    if (on) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
    const space = spaces().find(s => s.active);
    if (space) {
      this.panels[space.id] = on ? null : id;
      localStorage.setItem("panels", JSON.stringify(this.panels));
    }
  }

  syncPanel(space) {
    if (!space || space.id === this.currentSpace) return;
    const first = this.currentSpace === undefined;
    this.currentSpace = space.id;
    if (first && !(space.id in this.panels)) return;
    const want = this.panels[space.id] ?? null;
    if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
    else run("layout.hide", { id: "panel" });
  }

  row(space, tab, all, t) {
    const pane = this.representative(tab, all);
    const title = tab.named ? tab.name : (pane?.title || pane?.program?.name || tab.name || "Terminal");
    const cwd = pane?.cwd;
    return h_flex().id(`session-${tab.id}`).h(29).flex_none().min_w(0).pl(27).pr(6).gap(6).items_center().rounded(6)
      .bg(space.active && tab.active ? t.selected : t.chrome).hover(s => s.bg(t.hover)).cursor_pointer()
      .on_click(() => { if (!space.active) run("space.select", { id: space.id }); run("tab.select", { id: tab.id }); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: space.id } } }); })
      .child(this.status(tab.status, t))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(title).child(title))
      .when(Boolean(cwd), el => el.child(div().w_1_3().max_w(140).flex_none().overflow_hidden().text_ellipsis_start().text_color(t.dim).tooltip(cwd).child(cwd)));
  }

  space(space, all, t, available) {
    const folded = Boolean(this.folded[space.id]);
    return v_flex().min_w(0).flex_none()
      .child(h_flex().id(`workspace-${space.id}`).h(32).min_w(0).gap(5).px(6).items_center().rounded(6).hover(s => s.bg(t.hover))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: space.id } } }); })
        .child(div().id(`fold-${space.id}`).size(20).flex_none().flex().items_center().justify_center().cursor_pointer().tooltip(folded ? "Expand workspace" : "Collapse workspace")
          .on_click((_e, cx) => { cx.stop_propagation(); this.folded[space.id] = !folded; localStorage.setItem("folded", JSON.stringify(this.folded)); cx.notify(); })
          .child(folded ? "›" : "⌄"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).tooltip(space.name).cursor_pointer().on_click(() => run("space.select", { id: space.id })).child(space.name))
        .child(this.status(space.status, t))
        .child(div().id(`new-${space.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted).hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip(available ? "New session in this workspace" : "Machine unavailable")
          .on_click((_e, cx) => { cx.stop_propagation(); if (available) openOverlay({ mod: "workspace-new", kind: "popup", width: 250, height: 420, props: { space: space.id, machine: space.machine } }); }).child("+")))
      .when(!folded, el => el.children(space.tabs.map(tab => this.row(space, tab, all, t))));
  }

  render() {
    if (props()?.header) {
      const t = theme();
      return h_flex().size_full().items_center().pl(window()?.platform === "macos" && !window()?.fullscreen ? 76 : 14).text_color(t.foreground).font_semibold().child("Herdr");
    }
    const t = theme(), all = panes(), list = spaces(), current = list.find(s => s.active), ms = machines();
    this.syncPanel(current);
    const remote = ms.some(m => m.name !== null);
    const groups = remote ? ms : [{ name: null, layout: "ready" }];
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    // After Herdr updates, compare shipped workspace/tab controls and capabilities.
    // Put newly supported UI features without a dedicated home in these bottom tools.
    const tool = (id, label, action, on = false) => h_flex().id(id).h(27).px(8).items_center().rounded(6).cursor_pointer()
      .bg(on ? t.selected : t.chrome).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(12.5)
      .child(h_flex().h(32).px(12).items_center().justify_between().text_color(t.dim).child("Workspaces")
        .child(div().id("workspace-create").size(24).flex().items_center().justify_center().rounded(6).tooltip("New workspace").hover(s => s.bg(t.hover)).on_click(() => run("space.new")).child("+")))
      .child(v_flex().flex_1().min_h(0).px(6).overflow_y_scrollbar().children(groups.flatMap(m => {
        const matching = list.filter(s => (s.machine ?? null) === m.name);
        const heading = remote ? [div().h(24).px(8).text_size(11).text_color(t.dim).truncate().child(`${m.name ?? "This computer"}${m.layout === "ready" ? "" : ` · ${m.layout}`}`)] : [];
        return [...heading, ...matching.map(s => this.space(s, all, t, m.layout === "ready"))];
      })))
      .child(v_flex().border_t(1).border_color(t.border).p(6)
        .child(tool("files-tool", "Files", () => this.togglePanel("files"), panel && !panel.hidden && body?.active === "files"))
        .child(tool("changes-tool", "Changes", () => this.togglePanel("changes"), panel && !panel.hidden && body?.active === "changes"))
        .child(tool("settings-tool", "Settings", () => run("app.settings")))
        .child(tool("palette-tool", "Command palette", () => run("app.palette")))
        .when(Boolean(window()?.buttons), el => el.child(h_flex().children([
          tool("minimize-window", "−", () => run("window.minimize")),
          tool("maximize-window", "□", () => run("window.maximize")),
          tool("close-window", "×", () => run("window.close"))
        ]))));
  }
}
