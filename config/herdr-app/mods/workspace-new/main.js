import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, knownAgents, run, closeOverlay, props, spaces, machines } from "herdr";

export default class WorkspaceNew extends View {
  init(_props, cx) {
    this.space = props()?.space;
    this.machine = props()?.machine ?? null;
    this.agents = [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try { this.agents = (await knownAgents({ on: this.machine })).filter(a => a.installed); }
      catch { this.failed = true; }
      this.loaded = true;
      cx.notify();
    });
  }
  start(argv) {
    const space = spaces().find(s => s.id === this.space);
    if (!space || machines().find(m => m.name === this.machine)?.layout !== "ready") return;
    closeOverlay(props().overlay);
    run("tab.new", { space: this.space, ...(argv ? { argv } : {}) });
  }
  render() {
    const t = theme();
    const row = (id, icon, name, action) => h_flex().id(id).h(32).px(9).gap(10).items_center().rounded(6).hover(s => s.bg(t.selected)).on_click(action).child(icon).child(name);
    return v_flex().id("workspace-new").track_focus(this.handle).w_full().h(380).bg(t.popover).p(6).text_size(12.8).text_color(t.foreground)
      .child(row("new-terminal", svg("icons/shell.svg").size(14), "Terminal", () => this.start()))
      .child(div().px(9).pt(9).pb(4).text_size(11).text_color(t.dim).child("Installed agents"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(this.agents.map(a => row(`agent-${a.key}`, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name, () => this.start(a.run))))
        .when(this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : this.loaded ? "No installed agents" : "Checking installed agents…"))));
  }
}
