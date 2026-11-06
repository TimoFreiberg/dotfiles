import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, panes, exec, hc, watchFolder, theme, settings } from "herdr";

function diffRows(diff) {
  const rows = [];
  let path = "", old = 0, next = 0, inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      const sides = line.slice(13), middle = (sides.length - 3) / 2;
      path = Number.isInteger(middle) && sides.slice(0, middle) === sides.slice(middle + 3) && sides.slice(middle, middle + 3) === " b/"
        ? sides.slice(0, middle) : line.slice(line.lastIndexOf(" b/") + 3);
      rows.push({ kind: "file", path });
      continue;
    }
    if (!inHunk && line.startsWith("rename to ")) { path = line.slice(10); rows[rows.length - 1].path = path; continue; }
    if (!inHunk && line.startsWith("--- a/")) { path = line.slice(6); rows[rows.length - 1].path = path; continue; }
    if (!inHunk && line.startsWith("+++ b/")) { path = line.slice(6); rows[rows.length - 1].path = path; continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { old = +hunk[1]; next = +hunk[2]; inHunk = true; rows.push({ kind: "hunk", path, old, next, text: line }); continue; }
    if (!inHunk) continue;
    if (line[0] === "-") rows.push({ kind: "-", path, old: old++, text: line.slice(1) });
    else if (line[0] === "+") rows.push({ kind: "+", path, next: next++, text: line.slice(1) });
    else if (line[0] === " ") rows.push({ kind: " ", path, old: old++, next: next++, text: line.slice(1) });
  }
  return rows;
}

function diffFiles(diff) {
  const files = [];
  let file = null, inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = diffRows(line + "\n")[0].path;
      file = { path, old: path, next: path, added: 0, removed: 0, binary: false };
      files.push(file); inHunk = false;
    } else if (file && line.startsWith("@@ ")) inHunk = true;
    else if (file && !inHunk) {
      if (line.startsWith("rename from ")) file.old = line.slice(12);
      else if (line.startsWith("rename to ")) file.path = file.next = line.slice(10);
      else if (line === "--- /dev/null") file.old = null;
      else if (line === "+++ /dev/null") file.next = null;
      else if (line.startsWith("--- a/")) file.old = line.slice(6);
      else if (line.startsWith("+++ b/")) file.path = file.next = line.slice(6);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("new file mode ")) file.old = null;
      else if (line.startsWith("deleted file mode ")) file.next = null;
    } else if (file && line[0] === "+") file.added++;
    else if (file && line[0] === "-") file.removed++;
  }
  return files;
}

function itemKey(item) {
  if (item.type === "input") return "input";
  if (item.type === "draft") return `draft:${item.draft.id}`;
  const row = item.row;
  return JSON.stringify([item.type, row.kind, row.path, row.old ?? null, row.next ?? null]);
}

function draftLines(text, columns) {
  columns = Math.max(1, Math.floor(columns));
  return text.split("\n").flatMap(line => {
    const chars = Array.from(line), result = [];
    while (chars.length > columns) {
      let end = columns;
      // Break after whitespace where possible, preserving the original text.
      for (let i = columns - 1; i > 0; i--) {
        if (/\s/u.test(chars[i])) { end = i + 1; break; }
      }
      result.push(chars.splice(0, end).join(""));
    }
    result.push(chars.join(""));
    return result;
  });
}

function formatMessage(folder, revset, drafts) {
  return `Review comments on \`jj diff -r ${revset}\` in ${folder}:\n\n` + drafts.map(({ row, text }) => {
    if (row.kind === "file") return `- ${row.path} (file)\n  ${text}`;
    const location = row.kind === "-" ? `${row.old} (deleted line)` : row.next;
    return `- ${row.path}:${location} (\`${row.text.trim().slice(0, 120)}\`)\n  ${text}`;
  }).join("\n");
}

export default class Review extends View {
  init(_props, cx) {
    const options = props() || {};
    this.folder = options.folder; this.requested = options.revset || "@"; this.terminal = options.terminal;
    this.rows = []; this.files = []; this.collapsed = {}; this.viewed = {}; this.drafts = []; this.nextDraftId = 1; this.selected = null; this.refreshError = null; this.actionError = null; this.watchError = null; this.loading = false;
    this.scroll = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Comment, then press Enter" });
    this.input.on("submit", (_e, cx) => {
      const text = this.input.value().trim();
      if (text && this.selected) this.drafts.push({ id: this.nextDraftId++, row: this.selected, text });
      this.input.set_value(""); this.selected = null; cx.notify();
    });
    if (this.folder) {
      this.refresh(cx);
      cx.timer.every(3000, (cx) => this.refresh(cx));
      cx.spawn(async (cx) => {
        try {
          for (;;) {
            const paths = await watchFolder(this.folder);
            // `jj diff` writes here; watching those writes would trigger another refresh.
            if (paths.some(path => ![`${this.folder}/.jj`, `${this.folder}/.git`].some(dir => path === dir || path.startsWith(dir + "/")))) this.refresh(cx);
          }
        }
        catch (e) { this.watchError = `Watch failed: ${e}`; cx.notify(); }
      });
    }
  }

  refresh(cx) {
    if (this.loading) { this.pending = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      let changed = false;
      try {
        let revset = this.requested;
        let result = await exec("jj", ["diff", "--git", "--color=never", "-r", revset], { cwd: this.folder });
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
        // after `jj commit` the working copy is empty and the work is in `@-`
        if (revset === "@" && !result.stdout) {
          revset = "@-";
          result = await exec("jj", ["diff", "--git", "--color=never", "-r", revset], { cwd: this.folder });
          if (result.code !== 0) throw new Error(result.stderr || result.stdout);
        }
        if (this.revset !== revset || this.refreshError) changed = true;
        this.revset = revset;
        if (this.diff !== result.stdout) {
          changed = true; this.diff = result.stdout;
          const rows = diffRows(result.stdout);
          // a draft stays attached only if its row is unchanged (same path, line numbers,
          // and text). Otherwise it keeps the old row and shows up under "Outdated drafts".
          const byContent = new Map(rows.map(row => [JSON.stringify(row), row]));
          const matching = row => byContent.get(JSON.stringify(row));
          for (const draft of this.drafts) draft.row = matching(draft.row) || draft.row;
          if (this.selected) this.selected = matching(this.selected) || null;
          this.rows = rows; this.files = diffFiles(result.stdout);
        }
        this.refreshError = null;
      } catch (e) { const error = String(e); if (error !== this.refreshError) changed = true; this.refreshError = error; }
      finally {
        this.loading = false; if (changed) cx.notify();
        if (this.pending) { this.pending = false; this.refresh(cx); }
      }
    });
  }

  send(cx) {
    if (!this.drafts.length || this.sending) return;
    const drafts = this.drafts.slice(); this.sending = true; this.actionError = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await hc(["send", this.terminal, formatMessage(this.folder, this.revset, drafts)]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
        this.drafts = this.drafts.filter(d => !drafts.includes(d));
      } catch (e) { this.actionError = `Send failed: ${e}`; }
      finally { this.sending = false; cx.notify(); }
    });
  }

  open(cx) {
    if (!this.selected) return;
    const row = this.selected, line = row.next || row.old || 1;
    this.actionError = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await exec("zed", [`${this.folder}/${row.path}:${line}`]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      } catch (e) { this.actionError = `Open in Zed failed: ${e}`; cx.notify(); }
    });
  }

  openDiff(cx) {
    if (!this.files.some(file => !file.binary) || this.opening) return;
    this.actionError = null; this.opening = true; cx.notify();
    const args = [this.folder, this.revset, JSON.stringify(this.files.filter(file => !file.binary))];
    cx.spawn(async (cx) => {
      try {
        const result = await exec("bash", ["-c", 'exec "$HOME/.config/herdr-app/mods/jj-review/open-diff" "$@"', "jj-review", ...args]);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      } catch (e) { this.actionError = `Open diff in Zed failed: ${e}`; }
      finally { this.opening = false; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), items = [], look = settings();
    const font = look.font_family || look.font || "JetBrains Mono", size = (look.font_size || 14) / (look.zoom || 1), rowHeight = Math.ceil(size * 1.65);
    // Account for panel padding, borders and a scrollbar; reserve extra width for font variance.
    const columns = Math.max(1, Math.floor(((this.diffWidth || 320) - 56) / (size * 0.7)));
    const files = Object.fromEntries(this.files.map(file => [file.path, file]));
    const rowSet = new Set(this.rows);
    const outdated = this.drafts.filter(draft => !rowSet.has(draft.row));
    const draftsByRow = new Map();
    for (const draft of this.drafts) {
      if (!draftsByRow.has(draft.row)) draftsByRow.set(draft.row, []);
      draftsByRow.get(draft.row).push(draft);
    }
    let hidden = false;
    for (const row of this.rows) {
      if (row.kind === "file") hidden = !!this.collapsed[row.path];
      if (hidden && row.kind !== "file") continue;
      items.push({ type: "diff", row });
      if (row.kind === "file") { items.push({ type: "viewed", row }); items.push({ type: "comment", row }); }
      for (const draft of draftsByRow.get(row) || []) items.push({ type: "draft", draft, lines: draftLines(draft.text, columns) });
      if (row === this.selected) items.push({ type: "input" });
    }
    const byKey = new Map(items.map(item => [itemKey(item), item]));
    const terminal = panes().find(p => p.terminal === this.terminal);
    return v_flex().id("jj-review").size_full().min_h(0).bg(t.background).text_color(t.foreground).font_family(font).text_size(size)
      .child(h_flex().flex_none().p(8).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().child(`${this.folder || "No folder"} · ${this.revset || this.requested} · ${terminal?.title || this.terminal || "No terminal"}`))
        .child(div().id("refresh").cursor_pointer().on_click((_e, cx) => this.refresh(cx)).child("Refresh")))
      .when(outdated.length > 0, e => e.child(v_flex().id("outdated-drafts").flex_none().max_h(180).overflow_y_scrollbar().p(8).gap(4).bg(t.raised)
        .child(div().font_semibold().child("Outdated drafts"))
        .children(outdated.map((draft, i) => h_flex().gap(8).items_center()
          .child(div().flex_1().child(`${draft.row.path}${draft.row.kind === "file" ? " (file)" : `:${draft.row.next || draft.row.old}${draft.row.kind === "-" ? " (deleted line)" : ""}`} — ${draft.text}`))
          .child(div().id(`remove-outdated-${i}`).cursor_pointer().on_click((_e, cx) => { this.drafts = this.drafts.filter(d => d !== draft); cx.notify(); }).child("✕"))))))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().w(180).flex_none().overflow_y_scrollbar().bg(t.raised).p(8).gap(4)
          .child(div().font_semibold().child(`Files ${this.files.length}`))
          .children(this.files.map(file => h_flex().id(`file-${file.path}`).cursor_pointer().gap(4).on_click((_e, cx) => {
            const index = items.findIndex(item => item.row?.kind === "file" && item.row.path === file.path);
            if (index >= 0) this.scroll.scroll_to_item(index, "top"); cx.notify();
          }).child(div().flex_1().min_w(0).truncate().child(file.path))
            .child(div().text_color(t.ansi2).child(`+${file.added}`)).child(div().text_color(t.ansi1).child(`−${file.removed}`)))))
        .child(v_flex().id("diff-column").flex_1().min_w(0).h_full().relative()
          .on_size_change((bounds, cx) => { if (this.diffWidth !== bounds.width) { this.diffWidth = bounds.width; cx.notify(); } })
          .child(v_virtual_list("review-rows", items.length, items.map(i => i.type === "input" ? rowHeight + 16 : i.type === "draft" ? rowHeight * (i.lines.length + 1) + 18 : rowHeight), i => itemKey(items[i]), range => items.slice(range.start, range.end).map(item => {
            if (item.type === "input") return div().h(rowHeight + 16).px(12).py(4).bg(t.raised).child(Input.new(this.input).h_full().text_size(size));
            if (item.type === "draft") return v_flex().h(rowHeight * (item.lines.length + 1) + 18).px(12).py(8).bg(t.background)
              .child(v_flex().size_full().px(8).border_1().border_color(t.accent).rounded("md").bg(t.raised)
                .child(div().h(rowHeight).text_color(t.accent).child("Comment · ✕ Remove"))
                .children(item.lines.map(line => div().h(rowHeight).child(line))));
            if (item.type === "viewed") return div().h(rowHeight).px(8).bg(t.raised).text_color(t.dim).child(this.viewed[item.row.path] ? "☑ Viewed" : "☐ Viewed");
            if (item.type === "comment") return div().h(rowHeight).px(8).bg(t.raised).text_color(t.accent).child("＋ Comment on file");
            const row = item.row;
            if (row.kind === "file") {
              const file = files[row.path] || { added: 0, removed: 0 };
              return h_flex().h(rowHeight).px(8).gap(8).items_center().bg(t.raised)
                .child(div().flex_1().min_w(0).truncate().font_semibold().child(`${this.collapsed[row.path] ? "▸" : "▾"}  ${row.path}`))
                .child(div().text_color(t.ansi2).child(`+${file.added}`)).child(div().text_color(t.ansi1).child(`−${file.removed}`));
            }
            if (row.kind === "hunk") return div().h(rowHeight).px(8).bg(t.raised).text_color(t.dim).truncate().child(row.text);
            const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
            return h_flex().h(rowHeight).bg(t.background)
              .child(div().h_full().w(41).pr(6).text_right().text_color(tint ? t.foreground : t.dim).when(Boolean(tint), e => e.bg(tint + "20")).child(String(row.old || "")))
              .child(div().h_full().w(41).pr(6).text_right().text_color(tint ? t.foreground : t.dim).when(Boolean(tint), e => e.bg(tint + "20")).child(String(row.next || "")))
              .child(div().h_full().flex_1().min_w(0).truncate().when(Boolean(tint), e => e.bg(tint + "40")).child(`${row.kind}${row.text}`));
          })).size_full().track_scroll(this.scroll).on_item_click((key, cx) => {
            const item = byKey.get(key);
            if (item?.type === "viewed") { this.viewed[item.row.path] = !this.viewed[item.row.path]; this.collapsed[item.row.path] = this.viewed[item.row.path]; }
            else if (item?.type === "draft") this.drafts = this.drafts.filter(d => d !== item.draft);
            else if (item?.type === "diff" && item.row.kind === "file") this.collapsed[item.row.path] = !this.collapsed[item.row.path];
            else if (item?.type === "comment" || (item?.type === "diff" && item.row.kind !== "hunk")) { this.selected = item.row; this.input.set_value(""); this.input.focus(); }
            cx.notify();
          }))
          .child(Scrollbar.vertical("review-rows").viewport_from_layout().absolute().inset_0())))
      .when(Boolean(this.refreshError), e => e.child(div().px(8).text_color(t.ansi1).child(this.refreshError)))
      .when(Boolean(this.actionError), e => e.child(div().px(8).text_color(t.ansi1).child(this.actionError)))
      .when(Boolean(this.watchError), e => e.child(div().px(8).text_color(t.ansi1).child(this.watchError)))
      .child(h_flex().flex_none().p(8).gap(12)
        .child(div().id("open-diff").cursor_pointer().on_click((_e, cx) => this.openDiff(cx)).child(this.opening ? "Opening…" : "Open diff in Zed"))
        .when(Boolean(this.selected), e => e.child(div().id("open-zed").cursor_pointer().on_click((_e, cx) => this.open(cx)).child("↗ line in Zed")))
        .child(div().flex_1())
        .child(div().id("send").cursor_pointer().on_click((_e, cx) => this.send(cx)).child(this.sending ? "Sending…" : `Send ${this.drafts.length} comments`)));
  }
}
