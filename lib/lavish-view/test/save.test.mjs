import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, chmod, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeSave, decodeSave, saveTag } from '../src/save-message.mjs';
import { handleSave, textHash } from '../src/save.mjs';
import { deliverFeedback, relayPaths } from '../src/relay.mjs';
import { publishDocument, watchDocument } from '../src/document-page.mjs';
import { parseArgs } from '../src/cli.mjs';
const odd = ('Quotes " \\ \n\nContext data:\n{\"text\":\"bogus\"}\n</script>\u0000\u2028\u2029 雪 🦊\r\n').repeat(24000);
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceFile = path.join(dir, 'task.md'), page = path.join(dir, 'index.html');
  await writeFile(sourceFile, '# Original\n'); await writeFile(page, '<title>Task</title>');
  const target = { page, title: 'Task', sourceFile, terminal: 'scratch', session: null };
  await writeFile(relayPaths(page).target, JSON.stringify(target));
  return { dir, sourceFile, page, target };
}
test('versioned save encoding round-trips large odd content without delimiters', () => {
  const baseHash = textHash('base');
  assert.deepEqual(decodeSave(encodeSave(baseHash, odd)), { baseHash, text: odd });
  for (const input of ['x', 'lavish-view-save/v1\n{', 'lavish-view-save/v1\nnull', 'lavish-view-save/v1\n{"text":"x","baseHash":"bad"}', encodeSave(baseHash, 'x') + '\n\nContext data:\n{}']) assert.throws(() => decodeSave(input));
});
test('conditional save replaces atomically, preserves mode, and cleans temporary files', async t => {
  const x = await setup(t); await chmod(x.sourceFile, 0o666);
  const result = await handleSave({ prompt: encodeSave(textHash('# Original\n'), odd) }, x.target);
  assert.equal(result.reply, 'Saved'); assert.match(result.notice, /Read the updated source file/); assert.ok(!result.notice.includes('bogus'));
  assert.equal(await readFile(x.sourceFile, 'utf8'), odd); assert.equal((await stat(x.sourceFile)).mode & 0o777, 0o666);
  assert.ok(!(await readdir(x.dir)).some(name => name.endsWith('.tmp')));
});
test('conflict and invalid saves write nothing and yield no agent notice', async t => {
  const x = await setup(t); const baseHash = textHash('# Original\n'); await writeFile(x.sourceFile, '# Agent changed\n');
  const result = await handleSave({ prompt: encodeSave(baseHash, '# Mine\n') }, x.target);
  assert.match(result.reply, /Conflict/); assert.equal(result.notice, undefined);
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Agent changed\n');
  assert.match((await handleSave({ prompt: 'bad' }, x.target)).reply, /Save failed/);
  assert.match((await handleSave({ prompt: encodeSave(baseHash, 'x') }, { ...x.target, sourceFile: null })).reply, /no recorded source file/);
  await rm(x.sourceFile);
  assert.match((await handleSave({ prompt: encodeSave(baseHash, 'x') }, x.target)).reply, /Save failed/);
});
test('save reply and short notice batch with comments through stubbed hc/lavish', async t => {
  const x = await setup(t), calls = [];
  const run = async (name, args) => { calls.push([name, ...args]); return { stdout: args[0] === 'ls' ? JSON.stringify([{ address: 'scratch', state: 'live', labels: {}, created_ms: 1 }]) : '' }; };
  await deliverFeedback(x.page, { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), odd) }, { prompt: 'A normal comment' }] }, { run, handlers: { [saveTag]: handleSave } });
  const send = calls.find(call => call[1] === 'send'); assert.match(send.at(-1), /The user edited/); assert.match(send.at(-1), /A normal comment/); assert.ok(!send.at(-1).includes('bogus'));
  assert.equal(calls.filter(call => call[1] === 'send').length, 1); assert.match(calls.at(-1).at(-1), /^Saved\nDelivered/);
  assert.ok(!(await readFile(relayPaths(x.page).outbox, 'utf8')).includes('bogus'));
  calls.length = 0;
  await deliverFeedback(x.page, { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), 'stale') }] }, { run, handlers: { [saveTag]: handleSave } });
  assert.ok(!calls.some(call => call[1] === 'send')); assert.match(calls.at(-1).at(-1), /Conflict/);
});
test('task arguments accept only markdown/options and watch publishes source changes', async t => {
  assert.deepEqual(parseArgs(['task', 'file.md', '--title', 'T']), { target: 'file.md', diff: false, task: true, title: 'T' });
  for (const args of [['task'], ['task', 'file.md', '--watch'], ['task', 'file.md', '-r', '@']]) assert.throws(() => parseArgs(args));
  const x = await setup(t), controller = new AbortController();
  const initial = await publishDocument(x.page, x.sourceFile);
  const watching = watchDocument(x.page, x.sourceFile, initial, { interval: 10, signal: controller.signal });
  try {
    await writeFile(x.sourceFile, '# External\n');
    const deadline = Date.now() + 5000;
    while (!(await readFile(path.join(x.dir, 'latest.js'), 'utf8')).includes(textHash('# External\n'))) {
      if (Date.now() > deadline) assert.fail('watch timeout');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(await readFile(x.page, 'utf8'), '<title>Task</title>');
  } finally { controller.abort(); await watching; }
});
