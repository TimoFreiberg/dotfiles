import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import anchor from 'markdown-it-anchor';
import { createDocumentEditor, watchDocumentData } from './document-editor.mjs';
import { parsePR, serializePR } from '../src/pr-format.mjs';
import { encodeCreatePR, actionTag } from '../src/action-message.mjs';

const app = document.getElementById('app');
app.className = 'pr';
app.innerHTML = `<header data-lavish-action><h1>Pull request draft</h1><p id="repo"></p><p id="head"></p><details><summary>Commits at page creation</summary><ul id="commits"></ul></details><p id="source"></p></header><section class="pr-form"><label for="pr-title" data-lavish-action>Title</label><input id="pr-title" data-lavish-action type="text" autocomplete="off"><nav aria-label="Body view" data-lavish-action><strong>Body</strong><button id="edit" aria-pressed="true">Edit</button><button id="rendered" aria-pressed="false">Rendered</button></nav><textarea id="editor" aria-label="PR body" data-lavish-action spellcheck="false"></textarea><article id="preview" class="document" hidden></article><footer data-lavish-action><button id="save">Save</button><span>⌘S / Ctrl+S</span><button id="create-pr">Create PR</button><p id="status" role="status">Loading source file…</p><aside id="changed" hidden><p>The file changed on disk. Your unsaved edits are kept.</p><button id="reload">Reload (discard mine)</button><button id="keep">Keep mine</button></aside></footer></section>`;
const byId = id => document.getElementById(id);
const title = byId('pr-title'), body = byId('editor'), preview = byId('preview');
const md = new MarkdownIt({ html: true, linkify: true });
md.use(taskLists).use(anchor, { permalink: anchor.permalink.linkInsideHeader({ symbol: '#' }) });
const render = () => { preview.innerHTML = md.render(body.value); };
const status = text => { byId('status').textContent = text; };
// Allow an empty title while typing; validate before sending, not during dirty checks.
const getText = () => `# ${title.value}\n${body.value}`;
const editor = createDocumentEditor({
  getText,
  setText: text => { const draft = parsePR(text); title.value = draft.title; body.value = draft.body; render(); },
  normalizeText: text => serializePR(parsePR(text.replace(/\r\n?/g, '\n'))),
  changed: value => { byId('changed').hidden = !value; }, status,
});
const submit = action => {
  try { serializePR({ title: title.value, body: body.value }); }
  catch (error) { status(error.message); return; }
  if (action) editor.send({ encode: encodeCreatePR, tag: actionTag, context: 'Save draft and create PR', sent: 'Create PR sent; the relay saves first. Check the Lavish reply, then continue in the new herdr terminal.' });
  else editor.save();
};
byId('save').onclick = () => submit(false);
byId('create-pr').onclick = () => submit(true);
byId('reload').onclick = editor.reload;
byId('keep').onclick = editor.keep;
for (const view of ['edit', 'rendered']) byId(view).onclick = () => {
  body.hidden = view !== 'edit'; preview.hidden = view !== 'rendered';
  byId('edit').setAttribute('aria-pressed', String(view === 'edit'));
  byId('rendered').setAttribute('aria-pressed', String(view === 'rendered'));
  if (view === 'rendered') render();
};
for (const input of [title, body]) input.addEventListener('input', () => status(editor.dirty() ? 'Unsaved edits' : 'Up to date with disk'));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation(); submit(false);
  }
}, true);
window.addEventListener('beforeunload', event => { if (editor.dirty()) { event.preventDefault(); event.returnValue = ''; } });
const pr = globalThis.lavishViewPR;
byId('repo').textContent = `Repository: ${pr.repo}`;
byId('head').textContent = `Head: ${pr.rev} (${pr.head})`;
for (const text of pr.commits) { const li = document.createElement('li'); li.textContent = text; byId('commits').append(li); }
watchDocumentData(data => {
  try { parsePR(data.text); byId('source').textContent = data.sourceFile; editor.update(data); }
  catch (error) { status(`Disk update failed: ${error.message}. Fix the source file; your edits are kept.`); }
}, status);
