import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { spaces, theme, shared, setShared, exec, home, props, closeOverlay, commands, window } from "herdr";
import { artifactKey, seeArtifact, removeArtifact, hasArtifactWebView, openArtifact, age } from "./artifact-logic.js";

function fuzzyScore(value, query) {
  value = value.toLowerCase(); query = query.toLowerCase();
  if (!query || value === query) return 0;
  if (value.startsWith(query)) return 1;
  const substring = value.indexOf(query); if (substring >= 0) return 2 + substring;
  let at = 0, score = 100;
  for (const char of query) {
    const found = value.indexOf(char, at); if (found < 0) return Infinity;
    score += found - at; at = found + 1;
  }
  return score;
}

export default class TaskArtifacts extends View {
  init(_props, cx) {
    this.space = props()?.space ?? spaces().find(s => s.active)?.id;
    this.filter = InputState.new({ placeholder: "Find an artifact by title or path" });
    this.handle = cx.focus_handle(); this.scroll = VirtualListScrollHandle.new(); this.selected = null;
    this.filter.on("change", (_e, cx) => {
      this.selected = null; this.scroll.scroll_to_item(0); cx.notify();
    });
    this.filter.on("submit", (_e, cx) => {
      const item = this.selection(this.items()); if (item) this.open(this.space, item, cx);
    });
    cx.bind_keys([
      {keystroke:"tab", action:"task-artifact-next", context:"TaskArtifactPicker"},
      {keystroke:"shift-tab", action:"task-artifact-prev", context:"TaskArtifactPicker"},
      {keystroke:"down", action:"task-artifact-next", context:"TaskArtifactPicker"},
      {keystroke:"up", action:"task-artifact-prev", context:"TaskArtifactPicker"},
      {keystroke:"escape", action:"task-artifact-close", context:"TaskArtifactPicker"},
    ]);
    this.filter.focus();
  }
  close() { this.filter?.release(); }
  items() {
    const query = this.filter.value().trim();
    return ((shared(artifactKey) ?? {})[this.space] ?? []).map(item => ({item, score: Math.min(
      fuzzyScore(item.title, query), fuzzyScore(item.path, query))}))
      .filter(row => Number.isFinite(row.score)).sort((a,b) => a.score - b.score || b.item.added - a.item.added)
      .map(row => row.item);
  }
  selection(list) { return list.find(item => item.path === this.selected) ?? list[0]; }
  action(name, cx) {
    cx.stop_propagation();
    if (name === "task-artifact-close") { closeOverlay(props()?.overlay); return; }
    const list = this.items(), current = this.selection(list);
    if (current) {
      const index = (list.indexOf(current) + (name === "task-artifact-prev" ? -1 : 1) + list.length) % list.length;
      this.selected = list[index].path; this.scroll.scroll_to_item(index);
    }
    this.filter.focus(); cx.notify();
  }
  update(space, path, change) {
    const all = shared(artifactKey) ?? {};
    setShared(artifactKey, {...all, [space]: change(all[space] ?? [], path)});
  }
  open(space, item, cx) {
    if (this.opening) return;
    const overlay = props()?.overlay;
    this.error = null; this.opening = item.path; cx.notify();
    cx.spawn(async cx => {
      try {
        const opened = await openArtifact(exec, item, space, {
          web: hasArtifactWebView(window()?.platform, commands()), home: home(), reopen: true,
        });
        if (!opened) throw new Error("The user ended this Lavish review");
        this.update(space, item.path, (list, path) => seeArtifact(list, path, item.added));
        closeOverlay(overlay);
      } catch (e) { this.error = String(e); }
      finally { this.opening = null; cx.notify(); }
    });
  }
  render(cx) {
    const t = theme(), list = this.items(), selected = this.selection(list);
    const index = selected ? list.indexOf(selected) : 0, selection = JSON.stringify([selected?.path, index]);
    if (selection !== this.renderedSelection) {
      this.renderedSelection = selection;
      // Shared updates can remove or reorder the selected row while the picker is open.
      cx.spawn(async cx => {
        if (this.renderedSelection !== selection) return;
        this.scroll.scroll_to_item(index); cx.notify();
      });
    }
    return v_flex().id("artifact-picker").track_focus(this.handle).key_context("TaskArtifactPicker")
      .on_action("task-artifact-next", (_e,cx) => this.action("task-artifact-next",cx))
      .on_action("task-artifact-prev", (_e,cx) => this.action("task-artifact-prev",cx))
      .on_action("task-artifact-close", (_e,cx) => this.action("task-artifact-close",cx))
      .size_full().min_h(0).bg(t.popover).p(14).gap(8).text_size(12.5).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Artifacts"))
        .child(div().id("artifact-close").px(6).py(2).rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
          .text_color(t.dim).tooltip("Close (Esc)").on_click((_e,cx) => this.action("task-artifact-close",cx)).child("×")))
      .child(Input.new(this.filter).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).whitespace_nowrap().text_ellipsis().tooltip(this.error).child(this.error)))
      .when(Boolean(this.opening), el => el.child(div().text_color(t.dim).child("Opening artifact…")))
      .child(div().relative().flex_1().min_h(0)
        .child(v_virtual_list("artifact-choices", list.length, 56, i => list[i].path,
          range => list.slice(range.start, range.end).map(item =>
            h_flex().id(`artifact-${item.path}`).h(56).min_w(0).gap(8).p(8).rounded(6).items_center().overflow_hidden().cursor_pointer()
              .when(item.path === selected?.path, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
              .child(div().flex_none().text_color(t.accent).child(item.seen ? " " : "●"))
              .child(v_flex().flex_1().min_w(0).gap(2)
                .child(div().truncate().child(item.title))
                .child(div().truncate().text_color(t.dim).tooltip(item.path).child(`${item.path.split("/").pop()} · ${age(item.added)}`)))))
          .size_full().track_scroll(this.scroll).on_item_click((path,cx) => {
            const item = this.items().find(item => item.path === path); if (item) this.open(this.space, item, cx);
          }))
        .child(Scrollbar.vertical("artifact-choices").absolute().inset_0())
        .when(!list.length, el => el.child(v_flex().absolute().inset_0().p(8).items_center().justify_center().text_color(t.dim)
          .child(this.filter.value().trim() ? "No matching artifacts" : "No artifacts for this task"))))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("↑/↓ or Tab/Shift-Tab to select · Enter to open · Esc to close"))
        .when(Boolean(selected), el => el.child(div().id("artifact-remove").px(6).py(4).rounded(5).cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.hover)).tooltip(`Remove ${selected.title} from list`)
          .on_click((_e,cx) => {
            cx.stop_propagation(); this.update(this.space, selected.path, removeArtifact);
            this.selected = null; this.scroll.scroll_to_item(0); this.filter.focus(); cx.notify();
          }).child("Remove"))));
  }
}
