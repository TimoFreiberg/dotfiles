import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, theme, shared, setShared, exec, home } from "herdr";
import { artifactKey, seeArtifact, removeArtifact, lavishUrl, openCommand, age } from "./artifact-logic.js";

export default class TaskArtifacts extends View {
  update(space, path, change) {
    const all = shared(artifactKey) ?? {};
    setShared(artifactKey, {...all, [space]: change(all[space] ?? [], path)});
  }
  open(space, item, cx) {
    if (this.opening) return;
    this.error = null; this.opening = item.path;
    cx.spawn(async cx => {
      try {
        const result = await exec("lavish-axi", [item.path, "--reopen", "--no-open"]);
        if (result.code) throw new Error(result.stderr || result.stdout || "Lavish failed");
        const url = lavishUrl(result.stdout);
        if (!url) throw new Error("Lavish did not return a URL");
        const app = await exec("test", ["-d", `${home()}/Applications/Lavish.app`]);
        const [command, args] = openCommand(url, app.code === 0);
        const opened = await exec(command, args);
        if (opened.code) throw new Error(opened.stderr || opened.stdout || "Could not open browser");
        this.update(space, item.path, (list, path) => seeArtifact(list, path, item.added));
      } catch (e) { this.error = String(e); }
      finally { this.opening = null; cx.notify(); }
    });
  }
  render() {
    const t = theme(), space = spaces().find(s => s.active)?.id;
    const list = [...((shared(artifactKey) ?? {})[space] ?? [])].sort((a,b) => b.added - a.added);
    return v_flex().size_full().min_h(0).bg(t.background).p(12).gap(8).text_size(12.5).text_color(t.foreground)
      .child(div().font_semibold().child("Artifacts"))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!list.length, el => el.child(div().text_color(t.dim).child("No artifacts for this task")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(list.map(item =>
        h_flex().id(`artifact-${item.path}`).min_w(0).gap(8).p(8).rounded(6).items_center().cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e,cx) => this.open(space, item, cx))
          .child(div().flex_none().text_color(t.accent).child(item.seen ? " " : "●"))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().truncate().child(item.title))
            .child(div().truncate().text_color(t.dim).child(`${item.path.split("/").pop()} · ${age(item.added)}`)))
          .child(div().id(`remove-${item.path}`).flex_none().px(5).text_color(t.dim).tooltip("Remove from list").on_click((_e,cx) => { cx.stop_propagation(); this.update(space, item.path, removeArtifact); }).child("✕")))));
  }
}
