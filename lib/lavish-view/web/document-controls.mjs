import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import anchor from 'markdown-it-anchor';
import frontMatter from 'markdown-it-front-matter';
import { createDocumentEditor } from './document-editor.mjs';

export const byId = id => document.getElementById(id);
export const status = text => { byId('status').textContent = text; };
export function markdownRenderer(body, preview, { hideFrontMatter = false } = {}) {
  const md = new MarkdownIt({ html: true, linkify: true });
  md.use(taskLists).use(anchor, { permalink: anchor.permalink.linkInsideHeader({ symbol: '#' }) });
  if (hideFrontMatter) md.use(frontMatter, () => {});
  return () => { preview.innerHTML = md.render(body.value); };
}
export function documentEditor(options) {
  return createDocumentEditor({ ...options, changed: value => { byId('changed').hidden = !value; }, status });
}
export function wireDocumentControls(editor, { body, preview, render, inputs = [body], save = editor.save }) {
  byId('save').onclick = save;
  byId('reload').onclick = editor.reload;
  byId('keep').onclick = editor.keep;
  for (const view of ['edit', 'rendered']) byId(view).onclick = () => {
    body.hidden = view !== 'edit'; preview.hidden = view !== 'rendered';
    byId('edit').setAttribute('aria-pressed', String(view === 'edit'));
    byId('rendered').setAttribute('aria-pressed', String(view === 'rendered'));
    if (view === 'rendered') render();
  };
  for (const input of inputs) input.addEventListener('input', () => status(editor.dirty() ? 'Unsaved edits' : 'Up to date with disk'));
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation(); save();
    }
  }, true);
  window.addEventListener('beforeunload', event => { if (editor.dirty()) { event.preventDefault(); event.returnValue = ''; } });
}
