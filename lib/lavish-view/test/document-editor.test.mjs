import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentEditor } from '../web/document-editor.mjs';
import { decodeSave } from '../src/save-message.mjs';
import { textHash } from '../src/save.mjs';
const version = text => ({ text, hash: textHash(text) });
function setup(t) {
  let text = '', banner = false, status;
  const messages = []; const previous = globalThis.window;
  globalThis.window = { lavish: { queuePrompt: (prompt, options) => messages.push({ prompt, options }), sendQueuedPrompts: () => messages.push('send') } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const editor = createDocumentEditor({ getText: () => text, setText: value => { text = value.replace(/\r\n?/g, '\n'); }, changed: value => { banner = value; }, status: value => { status = value; } });
  return { editor, messages, edit: value => { text = value; }, get text() { return text; }, get banner() { return banner; }, get status() { return status; } };
}
test('Keep mine rebases dirty detection as well as the next save hash', t => {
  const x = setup(t); x.editor.update(version('original')); x.edit('mine'); x.editor.update(version('external'));
  assert.ok(x.banner); x.editor.keep(); x.edit('original'); assert.ok(x.editor.dirty());
  x.editor.save(); assert.deepEqual(decodeSave(x.messages[0].prompt), { baseHash: textHash('external'), text: 'original' });
  assert.equal(x.messages[1], 'send'); assert.ok(x.editor.dirty(), 'queueing is not saving');
  x.editor.update(version('original')); assert.ok(!x.editor.dirty()); assert.ok(!x.banner);
});
test('disk reversion clears a stale conflict banner without discarding edits', t => {
  const x = setup(t); x.editor.update(version('original')); x.edit('mine'); x.editor.update(version('external'));
  x.editor.update(version('original')); assert.equal(x.text, 'mine'); assert.ok(!x.banner); assert.ok(x.editor.dirty());
  x.editor.save(); assert.equal(decodeSave(x.messages[0].prompt).baseHash, textHash('original'));
});
test('dirty disk changes block Save until a choice, and CRLF starts clean', t => {
  const x = setup(t); x.editor.update(version('original\r\n')); assert.ok(!x.editor.dirty());
  x.edit('mine'); x.editor.update(version('external')); x.editor.save(); assert.equal(x.messages.length, 0); assert.match(x.status, /Choose Reload/);
  x.editor.reload(); assert.equal(x.text, 'external'); assert.ok(!x.editor.dirty());
  globalThis.window = {}; x.editor.save(); assert.match(x.status, /Save unavailable/);
});
