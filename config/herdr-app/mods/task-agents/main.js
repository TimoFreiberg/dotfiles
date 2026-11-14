import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { spaces, panes, agents, terminals, theme, run, props, closeOverlay } from "herdr";
import { taskAgents } from "./agent-logic.js";

const nameOf = a => a.name || a.template || a.program?.name || a.address;

export default class TaskAgents extends View {
  init(_props, cx) {
    this.space = props()?.space;
    this.overlay = props()?.overlay;
    this.filter = InputState.new({placeholder: "Find an agent by name or address"});
    this.handle = cx.focus_handle(); this.scroll = VirtualListScrollHandle.new(); this.selected = null;
    this.filter.on("change", (_e, cx) => { this.selected = null; this.scroll.scroll_to_item(0); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { const item = this.selection(this.items()); if (item) this.open(item.address, cx); });
    cx.bind_keys([
      {keystroke:"tab", action:"task-agent-next", context:"TaskAgentPicker"},
      {keystroke:"shift-tab", action:"task-agent-prev", context:"TaskAgentPicker"},
      {keystroke:"down", action:"task-agent-next", context:"TaskAgentPicker"},
      {keystroke:"up", action:"task-agent-prev", context:"TaskAgentPicker"},
      {keystroke:"escape", action:"task-agent-close", context:"TaskAgentPicker"},
    ]);
    this.filter.focus();
  }
  close() { this.closed = true; this.filter?.release(); }
  items() {
    const list = spaces(), space = list.find(s => s.id === this.space), query = this.filter.value().trim().toLowerCase();
    return taskAgents(space, agents(), panes(), list, terminals()).filter(a => a.hidden &&
      `${nameOf(a)} ${a.address} ${a.status ?? ""}`.toLowerCase().includes(query));
  }
  selection(list) { return list.find(a => a.address === this.selected) ?? list[0]; }
  action(name, cx) {
    cx.stop_propagation();
    if (name === "task-agent-close") { this.closed = true; closeOverlay(this.overlay); return; }
    const list = this.items(), current = this.selection(list);
    if (current) {
      const index = (list.indexOf(current) + (name === "task-agent-prev" ? -1 : 1) + list.length) % list.length;
      this.selected = list[index].address; this.scroll.scroll_to_item(index);
    }
    this.filter.focus(); cx.notify();
  }
  open(address, cx) {
    if (this.closed) return;
    const list = spaces(), space = list.find(s => s.id === this.space), allPanes = panes();
    if (!space?.active) { this.error = "Select this task before opening an agent"; cx.notify(); return; }
    const pane = allPanes.find(p => p.terminal === address);
    if (pane) {
      if (!space.tabs.some(t => t.id === pane.tab)) { this.error = "Agent moved to another task"; cx.notify(); return; }
      run("pane.focus", {terminal:address});
    } else {
      const item = taskAgents(space, agents(), allPanes, list, terminals()).find(a => a.hidden && a.address === address);
      if (!item) { this.error = "Agent is no longer available in this task"; cx.notify(); return; }
      run("terminal.keep", {terminal:address, place:"tab"});
    }
    this.closed = true; closeOverlay(this.overlay);
  }
  render(cx) {
    const t = theme(), list = this.items(), selected = this.selection(list);
    const index = selected ? list.indexOf(selected) : 0, selection = JSON.stringify([selected?.address, index]);
    if (selection !== this.renderedSelection) {
      this.renderedSelection = selection;
      cx.spawn(async cx => { if (this.renderedSelection !== selection) return; this.scroll.scroll_to_item(index); cx.notify(); });
    }
    return v_flex().id("agent-picker").track_focus(this.handle).key_context("TaskAgentPicker")
      .on_action("task-agent-next", (_e,cx) => this.action("task-agent-next",cx))
      .on_action("task-agent-prev", (_e,cx) => this.action("task-agent-prev",cx))
      .on_action("task-agent-close", (_e,cx) => this.action("task-agent-close",cx))
      .size_full().min_h(0).bg(t.popover).p(14).gap(8).text_size(12.5).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Agents"))
        .child(div().id("agent-close").px(6).py(2).rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
          .text_color(t.dim).tooltip("Close (Esc)").on_click((_e,cx) => this.action("task-agent-close",cx)).child("×")))
      .child(Input.new(this.filter).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().relative().flex_1().min_h(0)
        .child(v_virtual_list("agent-choices", list.length, 56, i => list[i].address,
          range => list.slice(range.start, range.end).map(item =>
            h_flex().id(`agent-${item.address}`).h(56).min_w(0).gap(8).p(8).rounded(6).items_center().overflow_hidden().cursor_pointer()
              .when(item.address === selected?.address, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
              .child(v_flex().flex_1().min_w(0).gap(2).child(div().truncate().child(nameOf(item)))
                .child(div().truncate().text_color(t.dim).child(`${item.address} · ${item.status ?? "unknown"}`)))))
          .size_full().track_scroll(this.scroll).on_item_click((address,cx) => this.open(address,cx)))
        .child(Scrollbar.vertical("agent-choices").absolute().inset_0())
        .when(!list.length, el => el.child(v_flex().absolute().inset_0().p(8).items_center().justify_center().text_color(t.dim)
          .child(this.filter.value().trim() ? "No matching agents" : "No hidden agents for this task"))))
      .child(div().text_size(11).text_color(t.dim).child("↑/↓ or Tab/Shift-Tab to select · Enter to open · Esc to close"));
  }
}
