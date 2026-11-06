import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, theme, settings, readTextFile, writeTextFile, watchFolder, exec, notify } from "herdr";
import { links, decision } from "./doc-logic.js";

let allowedPath = path => Boolean(path);
let checkPath = async () => {};

export default class TaskDoc extends View {
  init(_props, cx) {
    this.path = props()?.path; this.base = {unknown: true}; this.loaded = false; this.conflict = false; this.busy = false; this.revision = 0;
    this.editor = EditorState.new({ value: "", soft_wrap: true, line_numbers: false, folding: false, font_family: settings().font_family, font_size: settings().font_size });
    this.editor.on("change", (_e, cx) => { if (!this.setting && allowedPath(this.path)) { this.revision++; this.changedAt = Date.now(); this.storeRecovery(this.editor.value(), this.base); cx.notify(); } });
    if (!allowedPath(this.path)) { this.error = "Invalid document path"; return; }
    this.refresh(cx);
    cx.timer.every(1000, cx => { if (this.loaded && this.recovery == null && !this.conflict && this.changedAt && Date.now() - this.changedAt >= 1000) this.save(cx); });
    cx.timer.every(10000, cx => this.refresh(cx));
    const dir = this.path.slice(0, this.path.lastIndexOf("/")) || "/";
    cx.spawn(async cx => { try { for (;;) { await checkPath(this.path); const paths = await watchFolder(dir); if (paths.includes(this.path) || paths.includes(dir)) this.refresh(cx); } } catch (e) { this.watchError = String(e); cx.notify(); } });
  }
  recoveryKey() { return `recovery2:${this.path}`; }
  legacyRecoveryKey() { return `recovery:${this.path}`; }
  storeRecovery(text, base) { localStorage.setItem(this.recoveryKey(), JSON.stringify({v: 2, text, base})); }
  clearRecovery() { localStorage.removeItem(this.recoveryKey()); localStorage.removeItem(this.legacyRecoveryKey()); }
  readRecovery() {
    const raw = localStorage.getItem(this.recoveryKey());
    if (raw !== null) {
      try { const value = JSON.parse(raw); if (value && value.v === 2 && typeof value.text === "string") return {text: value.text, base: typeof value.base === "string" || value.base === null ? value.base : {unknown: true}}; } catch {}
      return {text: raw, base: {unknown: true}};
    }
    const legacy = localStorage.getItem(this.legacyRecoveryKey());
    return legacy === null ? null : {text: legacy, base: {unknown: true}, legacy: true};
  }
  replace(text) { this.setting = true; this.editor.set_value(text ?? ""); this.setting = false; }
  refresh(cx) {
    if (this.closing || this.busy || !allowedPath(this.path)) return;
    this.busy = true;
    const revision = this.revision;
    cx.spawn(async cx => {
      try {
        await checkPath(this.path); const disk = await readTextFile(this.path);
        if (this.closing) return;
        if (!this.loaded) {
          this.loaded = true;
          if (this.revision !== revision) this.conflict = true;
          else { this.base = disk; this.replace(disk); this.recovery = this.readRecovery(); }
        } else if (this.recovery == null && !this.conflict) {
          const state = decision(disk, this.base, this.editor.value());
          if (state === "reload" && !this.changedAt) { this.base = disk; this.replace(disk); }
          else if (state === "banner" || (disk !== this.base && this.changedAt)) this.conflict = true;
        }
        this.error = null;
      } catch (e) { this.error = String(e); }
      finally { this.busy = false; cx.notify(); }
    });
  }
  restore(cx) { const saved = this.recovery; this.storeRecovery(saved.text, saved.base); if (saved.legacy) localStorage.removeItem(this.legacyRecoveryKey()); this.recovery = null; this.base = saved.base; this.replace(saved.text); this.revision++; this.changedAt = Date.now(); cx.notify(); }
  discard(cx) { this.recovery = null; this.clearRecovery(); cx.notify(); }
  async write(text, base) {
    try {
      await checkPath(this.path);
      if (base !== null && typeof base !== "string") throw new Error("Unknown document base");
      await writeTextFile(this.path, text, base);
      this.base = text; this.conflict = false; this.error = null;
      if (this.editor.value() === text) { this.changedAt = null; this.clearRecovery(); }
      else { this.changedAt = Date.now(); this.storeRecovery(this.editor.value(), this.base); }
    } catch (e) { this.conflict = true; this.error = String(e); }
  }
  save(cx, overwrite = false) {
    if (this.closing || this.busy || !this.loaded || this.recovery != null || !allowedPath(this.path)) return;
    this.busy = true;
    let done; this.inFlight = new Promise(resolve => { done = resolve; });
    cx.spawn(async cx => {
      try {
        let base = this.base;
        if (overwrite) { await checkPath(this.path); base = await readTextFile(this.path); }
        await this.write(this.editor.value(), base);
      } catch (e) { this.conflict = true; this.error = String(e); }
      finally { this.busy = false; this.inFlight = null; done(); cx.notify(); }
    });
  }
  reload(cx) {
    if (this.closing || this.busy || this.recovery != null || !allowedPath(this.path)) return;
    const revision = this.revision;
    this.busy = true;
    cx.spawn(async cx => { try { await checkPath(this.path); const disk = await readTextFile(this.path); if (this.closing) return; if (this.revision === revision) { this.base = disk; this.replace(disk); this.changedAt = null; this.conflict = false; this.error = null; this.clearRecovery(); } else this.conflict = true; } catch (e) { this.error = String(e); } finally { this.busy = false; cx.notify(); } });
  }
  open(url, cx) { if (!allowedPath(this.path)) return; cx.spawn(async cx => { try { const r = await exec("open", [url]); if (r.code) throw new Error(r.stderr || r.stdout); } catch (e) { this.error = String(e); cx.notify(); } }); }
  render() {
    const t = theme(), text = this.editor.value(), refs = links(text);
    const button = (id, label, action) => div().id(id).px(8).py(4).rounded(5).cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);
    return v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12)
      .child(h_flex().h(36).flex_none().px(8).gap(4).items_center().justify_end()
        .child(button("preview", this.preview ? "Edit" : "Preview", (_e, cx) => { this.preview = !this.preview; cx.notify(); }))
        .child(button("obsidian", "Obsidian", (_e, cx) => this.open(`obsidian://open?path=${encodeURIComponent(this.path)}`, cx)))
        .when(Boolean(refs.ticket), el => el.child(button("ticket", "Ticket", (_e, cx) => this.open(refs.ticket, cx))))
        .when(Boolean(refs.pr), el => el.child(button("pr", "PR", (_e, cx) => this.open(refs.pr, cx)))))
      .when(this.recovery !== null && this.recovery !== undefined, el => el.child(h_flex().px(10).gap(8).items_center().bg(t.raised).child("Unsaved edits from last time")
        .child(button("restore", "Restore", (_e, cx) => this.restore(cx))).child(button("discard", "Discard", (_e, cx) => this.discard(cx)))))
      .when(this.conflict && this.recovery == null, el => el.child(h_flex().px(10).gap(8).items_center().bg(t.raised).child("Changed on disk")
        .child(button("reload", "Reload", (_e, cx) => this.reload(cx))).child(button("keep", "Keep mine", (_e, cx) => this.save(cx, true)))))
      .when(Boolean(this.error), el => el.child(div().px(10).text_color(t.blocked).child(this.error)))
      .when(this.loaded && this.base === null && !this.conflict, el => el.child(h_flex().px(10).gap(8).items_center().child(`Missing: ${this.path}`).child(button("create", "Create", (_e, cx) => this.save(cx)))))
      .when(this.loaded && (this.base !== null || this.changedAt) && this.recovery == null, el => el.child(this.preview ? div().flex_1().min_h(0).p(12).overflow_y_scrollbar().child(TextView.markdown("preview-text", text)) : Editor.new(this.editor).flex_1().min_h(0).w_full()));
  }
  async close() {
    this.closing = true;
    try { await localStorage.flush(); } catch (e) { notify({ title: "Could not preserve task notes", body: String(e), level: "error" }); }
    if (this.inFlight) await this.inFlight;
    if (allowedPath(this.path) && this.loaded && this.recovery == null && this.changedAt) {
      await this.write(this.editor.value(), this.base);
      if (this.conflict) notify({ title: "Could not save task notes", body: `${this.path}: ${this.error}`, level: "error" });
    }
    try { await localStorage.flush(); } catch (e) { notify({ title: "Could not preserve task notes", body: String(e), level: "error" }); }
    this.editor.release();
  }
}
