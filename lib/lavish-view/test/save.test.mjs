import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, chmod, stat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { encodeSave, decodeSave, saveTag } from '../src/save-message.mjs';
import { handleSave, textHash } from '../src/save.mjs';
import { deliverFeedback, recoverFeedback, relayPaths } from '../src/relay.mjs';
import { atomicWrite } from '../src/files.mjs';
import { publishDocument, watchDocument } from '../src/document-page.mjs';
import { parseArgs } from '../src/cli.mjs';
const odd = ('Quotes " \\ \n\nContext data:\n{\"text\":\"bogus\"}\n</script>\u0000\u2028\u2029 雪 🦊\r\n').repeat(24000);
async function setup(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lavish-save-')));
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
test('result or completion persistence failure caches the save and restart recovers the notice', async t => {
  for (const failAt of ['result', 'completion']) for (const restart of [false, true]) {
    const x = await setup(t), calls = [], text = '# Mine\n';
    const feedback = { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), text) }] };
    let saves = 0, fail = true;
    const run = async (name, args) => { calls.push([name, ...args]); return { stdout: args[0] === 'ls' ? JSON.stringify([{ address: 'scratch', state: 'live', labels: {}, created_ms: 1 }]) : '' }; };
    const handlers = { [saveTag]: async (...args) => { saves++; return handleSave(...args); } };
    const write = async (file, content) => {
      if (fail && saves && (failAt === 'result' || JSON.parse(content)[0]?.pending === false)) { fail = false; throw new Error('outbox unavailable after rename'); }
      await atomicWrite(file, content);
    };
    await assert.rejects(deliverFeedback(x.page, feedback, { run, handlers, write }), /after rename/);
    assert.equal(await readFile(x.sourceFile, 'utf8'), text);
    const pending = JSON.parse(await readFile(relayPaths(x.page).outbox)); assert.equal(pending[0].pending, true);
    if (restart) await recoverFeedback(x.page, { run, handlers });
    else await deliverFeedback(x.page, feedback, { run, handlers, write });
    assert.equal(saves, restart && failAt === 'result' ? 2 : 1);
    assert.match(calls.find(call => call[1] === 'send').at(-1), /The user edited/);
    assert.match(calls.at(-1).at(-1), /^Saved\nDelivered/);
    assert.deepEqual(JSON.parse(await readFile(relayPaths(x.page).outbox)), []);
  }
});
test('pending save keeps its receipt source when the sidecar and delivery session change', async t => {
  const x = await setup(t), other = path.join(x.dir, 'other.md'), calls = [];
  await writeFile(other, '# Original\n');
  const feedback = { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), '# Mine\n') }] };
  await assert.rejects(deliverFeedback(x.page, feedback, { handlers: { [saveTag]: async () => { throw new Error('interrupted before save'); } } }), /interrupted/);
  await writeFile(relayPaths(x.page).target, JSON.stringify({ ...x.target, sourceFile: other, terminal: 'new-terminal', session: 'new-session' }));
  const run = async (name, args) => {
    calls.push([name, ...args]);
    return { stdout: args[0] === 'ls' ? JSON.stringify([{ address: 'moved-terminal', state: 'live', created_ms: 1, labels: { 'polytoken.session': 'new-session' } }]) : '' };
  };
  await recoverFeedback(x.page, { run, handlers: { [saveTag]: handleSave } });
  assert.equal(await readFile(other, 'utf8'), '# Original\n', 'replacement source is never written');
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Mine\n');
  const send = calls.find(call => call[1] === 'send');
  assert.equal(send[2], 'moved-terminal'); assert.ok(send[3].includes(`The user edited ${x.sourceFile}.`));
  assert.ok(!send[3].includes(`The user edited ${other}.`));
});
test('legacy pending handler without a receipt target is refused visibly', async t => {
  const x = await setup(t), replies = [];
  await writeFile(relayPaths(x.page).outbox, JSON.stringify([{ pending: true, results: [], states: [], feedback: { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), '# Mine\n') }] } }]));
  await recoverFeedback(x.page, { handlers: { [saveTag]: () => assert.fail('unsafe legacy handler must not run') }, run: async (name, args) => { replies.push(args.at(-1)); return { stdout: '' }; } });
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Original\n');
  assert.match(replies.join('\n'), /no recorded handler target.*No file or action was changed during recovery/);
  assert.deepEqual(JSON.parse(await readFile(relayPaths(x.page).outbox)), []);
});
test('worker crash after replacement recovers from a fresh process', async t => {
  const x = await setup(t), feedback = { prompts: [{ tag: saveTag, prompt: encodeSave(textHash('# Original\n'), '# Mine\n') }] };
  const relay = new URL('../src/relay.mjs', import.meta.url).href, save = new URL('../src/save.mjs', import.meta.url).href;
  const exec = promisify(execFile);
  const crashing = `import {deliverFeedback} from ${JSON.stringify(relay)}; import {handleSave} from ${JSON.stringify(save)};
    await deliverFeedback(${JSON.stringify(x.page)}, ${JSON.stringify(feedback)}, {handlers: {'lavish-view-save': async (...args) => {await handleSave(...args); process.exit(73);}}});`;
  await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', crashing]), error => error.code === 73);
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Mine\n');
  const recovering = `import {recoverFeedback} from ${JSON.stringify(relay)}; import {handleSave} from ${JSON.stringify(save)};
    await recoverFeedback(${JSON.stringify(x.page)}, {handlers: {'lavish-view-save': handleSave}, run: async (name,args) => {
      if(args[0]==='ls') return {stdout: JSON.stringify([{address:'scratch',state:'live',labels:{},created_ms:1}])};
      console.log(JSON.stringify([name,...args])); return {stdout:''}; }});`;
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', recovering]);
  assert.match(stdout, /The user edited/); assert.match(stdout, /Saved/); assert.ok(!stdout.includes('Conflict'));
  assert.deepEqual(JSON.parse(await readFile(relayPaths(x.page).outbox)), []);
});
test('interrupted save with later disk changes gives an inspection notice, not false certainty', async t => {
  const x = await setup(t); await writeFile(x.sourceFile, '# Later writer\n');
  const result = await handleSave({ prompt: encodeSave(textHash('# Original\n'), '# Mine\n') }, x.target, { recovering: true });
  assert.match(result.reply, /Interrupted save.*earlier replacement may have succeeded/);
  assert.ok(!result.reply.includes('Nothing was saved')); assert.match(result.notice, /Read the source file/);
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Later writer\n');
});
test('save retries recognize their completed replacement', async t => {
  const x = await setup(t), prompt = { prompt: encodeSave(textHash('# Original\n'), '# Mine\n') };
  assert.equal((await handleSave(prompt, x.target)).reply, 'Saved');
  const retry = await handleSave(prompt, x.target);
  assert.equal(retry.reply, 'Saved'); assert.match(retry.notice, /The user edited/);
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
