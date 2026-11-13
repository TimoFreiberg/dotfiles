import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import anchor from 'markdown-it-anchor';
import frontMatter from 'markdown-it-front-matter';
import { createDocumentEditor, watchDocumentData } from './document-editor.mjs';

const app = document.getElementById('app');
app.innerHTML = `<header data-lavish-action><h1>Task document</h1><p id="source"></p><nav aria-label="Document view"><button id="edit" aria-pressed="true">Edit</button><button id="rendered" aria-pressed="false">Rendered</button><button id="save">Save</button><span>⌘S / Ctrl+S</span></nav><p id="status" role="status">Loading source file…</p><aside id="changed" hidden><p>The file changed on disk. Your unsaved edits are kept.</p><button id="reload">Reload (discard mine)</button><button id="keep">Keep mine</button></aside></header><textarea id="editor" aria-label="Markdown text" data-lavish-action spellcheck="false"></textarea><article id="preview" class="document" hidden></article>`;
const byId = id => document.getElementById(id);
const textarea = byId('editor'), preview = byId('preview');
const md = new MarkdownIt({ html: true, linkify: true });
md.use(taskLists).use(anchor, { permalink: anchor.permalink.linkInsideHeader({ symbol: '#' }) });
md.use(frontMatter, () => {});
const render = () => { preview.innerHTML = md.render(textarea.value); };
const status = text => { byId('status').textContent = text; };
const editor = createDocumentEditor({
  getText: () => textarea.value,
  setText: text => { textarea.value = text; render(); },
  changed: value => { byId('changed').hidden = !value; }, status,
});
byId('save').onclick = editor.save;
byId('reload').onclick = editor.reload;
byId('keep').onclick = editor.keep;
for (const view of ['edit', 'rendered']) byId(view).onclick = () => {
  textarea.hidden = view !== 'edit'; preview.hidden = view !== 'rendered';
  byId('edit').setAttribute('aria-pressed', String(view === 'edit'));
  byId('rendered').setAttribute('aria-pressed', String(view === 'rendered'));
  if (view === 'rendered') render();
};
textarea.addEventListener('input', () => { status(editor.dirty() ? 'Unsaved edits' : 'Up to date with disk'); });
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation(); editor.save();
  }
}, true);
window.addEventListener('beforeunload', event => { if (editor.dirty()) { event.preventDefault(); event.returnValue = ''; } });
watchDocumentData(data => { byId('source').textContent = data.sourceFile; editor.update(data); }, status);
