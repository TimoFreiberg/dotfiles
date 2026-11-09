import { CodeView, getFiletypeFromFileName } from '@pierre/diffs';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { modelPatch } from '../src/diff/model.mjs';
import { commentLocation, quoteSelection, zedCommand, zedUrl } from './locations.mjs';

const app = document.querySelector('#app');
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
const state = { data: null, files: [], hash: null, latest: null, pending: null, split: false, viewed: new Set(), collapsed: new Set(), current: 0, hunk: -1, draft: null, storageFailed: false };
try { state.viewed = new Set(JSON.parse(localStorage.getItem('lavish-view-viewed') || '[]')); } catch { state.storageFailed = true; }
const header = el('header', null, 'page-header'), toolbar = el('div', null, 'toolbar'), sidebar = el('nav', null, 'sidebar'), viewport = el('div', null, 'viewport'), notice = el('div', null, 'notice'), draftHost = el('div', null, 'draft-host');
const layout = el('div', null, 'layout'); layout.append(sidebar, viewport); app.append(header, toolbar, notice, layout, draftHost);
let view, worker, workerUrl, fallingBack = false;
function persist() { try { localStorage.setItem('lavish-view-viewed', JSON.stringify([...state.viewed])); } catch { state.storageFailed = true; renderToolbar(); } }
function makeWorker() {
  workerUrl = URL.createObjectURL(new Blob([LAVISH_VIEW_WORKER_SOURCE], { type: 'text/javascript' }));
  return new WorkerPoolManager({ poolSize: 1, workerFactory: () => new Worker(workerUrl), onWorkerError: event => { event.preventDefault?.(); fallback(); } }, { theme: 'github-light', langs: [] });
}
function fallback() {
  if (fallingBack) return; fallingBack = true;
  try { worker?.terminate(); } catch {} worker = undefined;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  if (view) { const top = view.getScrollTop(); view.cleanUp(); createView(); setItems(); view.scrollTo({ type: 'position', position: top }); }
}
try { worker = makeWorker(); worker.initialize().catch(fallback); } catch { fallback(); }
function options() { return {
  theme: 'github-light', preferredHighlighter: 'shiki', diffStyle: state.split ? 'split' : 'unified', enableLineSelection: true,
  renderCustomHeader: (_metadata, context) => fileHeader(Number(context.item.id)),
  onLineSelectionEnd: (range, context) => { if (range) openDraft(Number(context.item.id), range); },
}; }
function currentAt(top) { let low = 0, high = state.files.length; while (low < high) { const mid = (low + high) >>> 1, itemTop = view.getTopForItem(String(mid)); if (itemTop != null && itemTop <= top + 1) low = mid + 1; else high = mid; } return Math.max(0, low - 1); }
function createView() { view = new CodeView(options(), worker); view.setup(viewport); view.subscribeToScroll(top => { const current = currentAt(top); if (current !== state.current) { state.current = current; state.hunk = -1; } }); }
createView();
function count(file) { let add = 0, del = 0, inHunk = false; for (const line of file.raw.split('\n')) { if (line.startsWith('@@ ')) inHunk = true; else if (inHunk && line.startsWith('+')) add++; else if (inHunk && line.startsWith('-')) del++; } return { add, del }; }
function summary(file) {
  if (file.parseError) return `Could not parse: ${file.parseError}`;
  if (file.status === 'binary') return 'Binary file changed';
  if (file.status === 'mode-only') return `mode ${file.oldMode} → ${file.newMode}`;
  if (file.status === 'renamed' && !file.parsed?.hunks?.length) return `${file.oldPath} → ${file.newPath}, no content change`;
  const parts = [];
  if (file.status === 'type-change') parts.push(`Type changed (${file.oldMode} → ${file.newMode})`);
  if (file.oldMode === '120000' || file.newMode === '120000') parts.push('Symbolic link');
  if (file.status === 'added') parts.push('New file');
  if (file.status === 'deleted') parts.push('Deleted file');
  if (file.status === 'renamed') parts.push(`${file.oldPath} → ${file.newPath}`);
  return parts.join(' · ');
}
function toggleViewed(index) { const key = state.files[index]?.viewedKey; if (!key) return; state.viewed.has(key) ? state.viewed.delete(key) : state.viewed.add(key); persist(); renderSidebar(); setItems(); }
function fileHeader(index) {
  const file = state.files[index]; if (!file) return el('div');
  const box = el('div', null, 'file-header'); box.dataset.file = file.newPath;
  const line = el('div', null, 'file-title');
  line.append(button(state.collapsed.has(file.newPath) ? '▶' : '▼', () => { state.collapsed.has(file.newPath) ? state.collapsed.delete(file.newPath) : state.collapsed.add(file.newPath); setItems(); }));
  line.append(el('strong', file.newPath)); const label = el('label', null, 'viewed'); const check = el('input'); check.type = 'checkbox'; check.checked = state.viewed.has(file.viewedKey); check.addEventListener('change', () => toggleViewed(index)); label.append(check, ' Viewed'); line.append(label); box.append(line);
  const description = summary(file); if (description) box.append(el('div', description, 'file-description'));
  if (file.parseError) box.append(el('pre', file.raw, 'raw'));
  for (const hunk of file.parsed?.hunks || []) {
    const side = file.status === 'deleted' ? 'deletions' : 'additions'; const lineNumber = Math.max(1, side === 'deletions' ? hunk.deletionStart : hunk.additionStart); const path = side === 'deletions' ? file.oldPath : file.newPath;
    const row = el('div', null, 'hunk-actions'); const link = el('a', `Open in Zed :${lineNumber}`); link.href = zedUrl(state.data.root, path, lineNumber); link.target = '_blank'; link.rel = 'noopener'; row.append(link, button('Copy Zed command', async () => { try { await navigator.clipboard.writeText(zedCommand(state.data.root, path, lineNumber)); } catch { window.prompt('Copy command', zedCommand(state.data.root, path, lineNumber)); } }));
    if (side === 'deletions' || (state.data.kind === 'jj' && state.data.to !== '@') || (state.data.kind === 'git' && state.data.to)) row.append(el('span', 'Working tree may differ from the reviewed revision', 'hint')); box.append(row);
  }
  return box;
}
const supportedLanguages = new Set(LAVISH_VIEW_LANGUAGES);
function itemFor(file, index) {
  if (file.parsed && !file.parseError) { const lang = getFiletypeFromFileName(file.parsed.name); file.parsed.lang = supportedLanguages.has(lang) ? lang : 'text'; return { id: String(index), type: 'diff', fileDiff: file.parsed, version: state.version, collapsed: state.collapsed.has(file.newPath) }; }
  return { id: String(index), type: 'file', file: { name: file.newPath, contents: '' }, collapsed: true };
}
function setItems() { state.version = (state.version || 0) + 1; if (view) view.setItems(state.files.map(itemFor)); }
function renderSidebar() {
  sidebar.replaceChildren(el('h2', `Files (${state.files.length})`));
  state.files.forEach((file, i) => { const c = count(file), item = button('', () => goFile(i)); item.className = 'file-link'; item.append(el('span', `${state.viewed.has(file.viewedKey) ? '✓ ' : ''}${file.newPath}`), el('span', `+${c.add} −${c.del}`, 'counts')); sidebar.append(item); });
}
function renderToolbar() {
  toolbar.replaceChildren(button(state.split ? 'Unified' : 'Split', toggleSplit), button('Keyboard shortcuts (?)', () => help.hidden = !help.hidden));
  if (state.storageFailed) toolbar.append(el('span', 'Viewed resets on reload', 'hint'));
}
function toggleSplit() { state.split = !state.split; view.setOptions(options()); renderToolbar(); }
const help = el('div', 'j / k: next / previous file · n / p: next / previous hunk · v: viewed · s: split · ?: help', 'help'); help.hidden = true; app.append(help);
function goFile(index) { if (!state.files.length) return; state.current = Math.max(0, Math.min(index, state.files.length - 1)); state.hunk = -1; view.scrollTo({ type: 'item', id: String(state.current), align: 'start' }); }
function goHunk(delta) {
  const hunks = []; state.files.forEach((file, i) => file.parsed?.hunks?.forEach(h => hunks.push({ i, line: Math.max(1, h.additionStart || h.deletionStart), side: h.additionCount ? 'additions' : 'deletions' })));
  if (!hunks.length) return;
  let at = state.hunk + delta;
  if (state.hunk < 0) {
    at = delta > 0 ? hunks.findIndex(h => h.i >= state.current) : hunks.findLastIndex(h => h.i <= state.current);
    if (at < 0) at = delta > 0 ? hunks.length - 1 : 0;
  }
  state.hunk = Math.max(0, Math.min(at, hunks.length - 1)); const h = hunks[state.hunk]; state.current = h.i; view.scrollTo({ type: 'line', id: String(h.i), lineNumber: h.line, side: h.side, align: 'start' });
}
document.addEventListener('keydown', event => { if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey && event.key !== '?' || event.composedPath().some(node => node instanceof Element && node.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))) return; const actions = { j: () => goFile(state.current + 1), k: () => goFile(state.current - 1), n: () => goHunk(1), p: () => goHunk(-1), v: () => toggleViewed(state.current), s: toggleSplit, '?': () => help.hidden = !help.hidden }; if (actions[event.key]) { event.preventDefault(); actions[event.key](); } });
function openDraft(index, range) {
  const file = state.files[index], location = commentLocation(file, range, state.data.revision); if (!location) { notice.textContent = 'Select lines on one side of the diff.'; return; }
  if (state.draft?.textarea.value) return;
  draftHost.replaceChildren(); const box = el('section', null, 'draft'), textarea = el('textarea'); textarea.placeholder = 'Write a comment'; const where = `${location.side} ${location.where} (${location.revision})`; box.append(el('strong', where), textarea);
  box.append(button('Queue comment', () => { if (!textarea.value.trim()) return; if (!window.lavish?.queuePrompt) { box.append(el('p', 'Comments require an active Lavish session.')); return; } const quote = quoteSelection(file.parsed, range); window.lavish.queuePrompt(`${where}\n\n${quote}\n\n${textarea.value}`, { tag: 'code-comment', text: where }); state.draft = null; draftHost.replaceChildren(); updateNotice(); }), button('Cancel', () => { state.draft = null; draftHost.replaceChildren(); updateNotice(); })); textarea.addEventListener('input', updateNotice); draftHost.append(box); state.draft = { textarea }; textarea.focus();
}
function updateNotice() {
  notice.replaceChildren(); if (!state.pending || state.pending === state.hash) return;
  notice.append('Diff changed — '); const refresh = button('Refresh', () => loadData(state.pending)); refresh.disabled = Boolean(state.draft?.textarea.value); notice.append(refresh); if (refresh.disabled) notice.append(' Finish or cancel your comment first.');
}
function render(data) {
  const top = view.getScrollTop(), current = currentAt(top), previous = state.files[current]?.newPath, itemTop = view.getTopForItem(String(current)), offset = itemTop == null ? 0 : itemTop - top; state.data = data; state.version = (state.version || 0) + 1; state.files = modelPatch(data.patch); state.current = Math.max(0, state.files.findIndex(f => f.newPath === previous));
  header.replaceChildren(el('h1', 'Diff review'), el('div', `${data.range} · ${data.rangeSource}`), el('div', `Generated ${data.generated || 'unknown'}`, 'hint')); if (data.commits) header.append(el('pre', Array.isArray(data.commits) ? data.commits.join('\n') : data.commits, 'commits'));
  renderToolbar(); renderSidebar(); setItems(); if (previous && state.files[state.current]?.newPath === previous) view.scrollTo({ type: 'item', id: String(state.current), align: 'start', offset }); else view.scrollTo({ type: 'position', position: top });
  if (!state.files.length) notice.textContent = `No changes in ${data.range}`; else updateNotice();
}
let loadingHash;
function script(src, onerror) { const node = document.createElement('script'); node.src = src; node.onload = () => node.remove(); node.onerror = () => { node.remove(); onerror?.(); }; document.head.append(node); }
function loadData(hash) { if (loadingHash) return; loadingHash = hash; script(`./data-${encodeURIComponent(hash)}.js?t=${Date.now()}`, () => { loadingHash = null; notice.textContent = 'Could not load diff data; waiting for the next update.'; }); }
globalThis.lavishViewData = data => { state.hash = loadingHash; loadingHash = null; state.pending = state.latest !== state.hash ? state.latest : null; render(data); };
globalThis.lavishViewLatest = hash => { state.latest = hash; if (!state.hash && !loadingHash) loadData(hash); else if (state.hash) { state.pending = hash !== state.hash ? hash : null; updateNotice(); } };
function poll() { script(`./latest.js?t=${Date.now()}`); } poll(); setInterval(poll, 2000);
