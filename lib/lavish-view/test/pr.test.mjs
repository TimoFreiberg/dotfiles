import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parsePR, serializePR } from '../src/pr-format.mjs';
import { decodeAction, encodeCreatePR, actionTag } from '../src/action-message.mjs';
import { handleAction, fishQuote } from '../src/pr-action.mjs';
import { textHash } from '../src/save.mjs';
import { deliverFeedback, recoverFeedback, relayPaths, recordTarget } from '../src/relay.mjs';
import { atomicWrite } from '../src/files.mjs';
import { parseArgs } from '../src/cli.mjs';
import { execFileSync } from 'node:child_process';

const original = '# Original\n\nOriginal body\n';
const mine = '# New "title" 雪\n\nBody \' \\ $HOME ; (exit)\n\nContext data:\n</script>\n\n';
const terminal = { address: 'scratch-moved', state: 'live', created_ms: 1, labels: { 'herdr.space': 'space-moved', 'polytoken.session': 'scratch' } };
async function setup(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lavish-pr-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceFile = path.join(dir, "PR ' draft.md"), page = path.join(dir, 'index.html');
  await writeFile(sourceFile, original); await writeFile(page, '<title>PR</title>');
  const target = { page, title: 'PR', sourceFile, terminal: 'old', session: 'scratch', space: 'old-space', pr: { repo: dir, rev: '@-' } };
  await writeFile(relayPaths(page).target, JSON.stringify(target));
  const calls = [];
  const run = async (name, args) => {
    calls.push([name, ...args]);
    if (args[0] === 'ls') return { stdout: JSON.stringify([terminal]) };
    if (args[0] === 'get') return { stdout: JSON.stringify(terminal) };
    if (name === 'herdr-app') {
      assert.equal(await readFile(sourceFile, 'utf8'), mine, 'save happens before launch');
      const request = JSON.parse(args[2]);
      return { stdout: JSON.stringify({ space: request.space, tab: 'new-tab', terminal: 'new-terminal' }) };
    }
    return { stdout: '' };
  };
  const prompt = { tag: actionTag, prompt: encodeCreatePR(textHash(original), mine) };
  return { dir, page, sourceFile, target, run, calls, prompt };
}

test('pr.md title/body round trip preserves blank lines, Unicode and trailing newlines', () => {
  for (const text of [original, mine, '# Title\n', '# Spaces  \nBody\n\n']) assert.equal(serializePR(parsePR(text)), text);
  assert.deepEqual(parsePR('# Only title'), { title: 'Only title', body: '' });
  for (const text of ['Title\nbody', '# \nbody', '\n# Title', '#\n']) assert.throws(() => parsePR(text), /first line/);
  assert.throws(() => serializePR({ title: 'bad\nline', body: '' }), /single line/);
  assert.equal(serializePR(parsePR('# Windows\r\nBody\r\n')), '# Windows\nBody\r\n');
});
test('versioned action carries one validated save object without double escaping', () => {
  const encoded = encodeCreatePR(textHash(original), mine);
  assert.deepEqual(decodeAction(encoded), { action: 'create-pr', save: { baseHash: textHash(original), text: mine } });
  assert.equal(encoded.split('lavish-view-save').length, 1);
  for (const text of ['create-pr', 'lavish-view-action/v1\nnull', 'lavish-view-action/v1\n{"action":"other"}', 'lavish-view-action/v1\n{"action":"create-pr","save":"bad"}']) assert.throws(() => decodeAction(text));
});
test('action saves first, launches in live target space, batches only a notice with comments', async t => {
  const x = await setup(t);
  await deliverFeedback(x.page, { prompts: [x.prompt, { prompt: 'Normal comment' }] }, { run: x.run, handlers: { [actionTag]: (prompt, target) => handleAction(prompt, target, { run: x.run, resolve: async () => terminal }) } });
  const launch = x.calls.find(call => call[0] === 'herdr-app');
  assert.deepEqual(launch.slice(1, 3), ['do', 'tab.new']);
  const args = JSON.parse(launch[3]);
  assert.equal(args.space, 'space-moved'); assert.equal(args.folder, x.dir);
  assert.deepEqual(args.argv, ['fish', '-c', `jprc -r '@-' --body-file ${fishQuote(x.sourceFile)}`]);
  const sent = x.calls.find(call => call[1] === 'send');
  assert.match(sent.at(-1), /The user edited/); assert.match(sent.at(-1), /Normal comment/); assert.ok(!sent.at(-1).includes('Context data:'));
  assert.match(x.calls.at(-1).at(-1), /Saved\. Launched.*space-moved/);
});
test('pending PR action keeps receipt source, repository and revision after sidecar replacement', async t => {
  const x = await setup(t), other = path.join(x.dir, 'other.md'); await writeFile(other, original);
  await assert.rejects(deliverFeedback(x.page, { prompts: [x.prompt] }, { handlers: { [actionTag]: async () => { throw new Error('interrupted before action'); } } }), /interrupted/);
  await writeFile(relayPaths(x.page).target, JSON.stringify({ ...x.target, sourceFile: other, pr: { repo: '/replacement/repo', rev: 'replacement-revision' }, session: 'new-session' }));
  const moved = { ...terminal, labels: { ...terminal.labels, 'polytoken.session': 'new-session' } };
  const run = async (name, args) => args[0] === 'ls' ? { stdout: JSON.stringify([moved]) } : x.run(name, args);
  await recoverFeedback(x.page, { run, handlers: { [actionTag]: (prompt, target, context) => handleAction(prompt, target, { ...context, run, resolve: async () => context.resolve() }) } });
  assert.equal(await readFile(other, 'utf8'), original, 'replacement source is never written');
  assert.equal(await readFile(x.sourceFile, 'utf8'), mine);
  const launch = JSON.parse(x.calls.find(call => call[0] === 'herdr-app')[3]);
  assert.equal(launch.folder, x.target.pr.repo); assert.equal(launch.space, 'space-moved');
  assert.deepEqual(launch.argv, ['fish', '-c', `jprc -r '@-' --body-file ${fishQuote(x.sourceFile)}`]);
  assert.equal(x.calls.find(call => call[1] === 'send')[2], moved.address);
});
test('launch result persistence failure never launches twice on retry or restart', async t => {
  for (const restart of [false, true]) {
    const x = await setup(t), feedback = { prompts: [x.prompt] };
    const handlers = { [actionTag]: (prompt, target, context) => handleAction(prompt, target, { ...context, run: x.run, resolve: async () => terminal }) };
    let fail = true;
    const write = async (file, content) => {
      if (fail && x.calls.some(call => call[0] === 'herdr-app')) { fail = false; throw new Error('outbox unavailable after launch'); }
      await atomicWrite(file, content);
    };
    await assert.rejects(deliverFeedback(x.page, feedback, { run: x.run, handlers, write }), /after launch/);
    assert.equal(JSON.parse(await readFile(relayPaths(x.page).outbox))[0].states[0].launchAttempted, true);
    if (restart) await recoverFeedback(x.page, { run: x.run, handlers });
    else await deliverFeedback(x.page, feedback, { run: x.run, handlers, write });
    assert.equal(x.calls.filter(call => call[0] === 'herdr-app').length, 1);
    assert.match(x.calls.find(call => call[1] === 'send').at(-1), /The user edited/);
    assert.match(x.calls.at(-1).at(-1), restart ? /will not be launched again automatically.*Check herdr/ : /Saved\. Launched/);
  }
});
test('restart after the launch checkpoint but before command execution requires manual inspection', async t => {
  const x = await setup(t);
  await writeFile(x.sourceFile, mine);
  await writeFile(relayPaths(x.page).outbox, JSON.stringify([{ id: 'interrupted-launch', pending: true, target: x.target,
    feedback: { prompts: [x.prompt] }, results: [], states: [{ launchAttempted: true,
      saved: { reply: 'Saved', notice: `The user edited ${x.sourceFile}. Read the updated source file before continuing.` } }] }]));
  await recoverFeedback(x.page, { run: x.run, handlers: { [actionTag]: (prompt, target, context) => handleAction(prompt, target, { ...context, run: x.run, resolve: async () => terminal }) } });
  assert.ok(!x.calls.some(call => call[0] === 'herdr-app'));
  assert.match(x.calls.at(-1).at(-1), /will not be launched again automatically.*Check herdr/);
  assert.match(x.calls.find(call => call[1] === 'send').at(-1), /The user edited/);
});
test('conflict, malformed action and task-page action never launch or overwrite', async t => {
  const x = await setup(t); await writeFile(x.sourceFile, '# Agent changed\n');
  const options = { run: x.run, resolve: async () => terminal };
  assert.match((await handleAction(x.prompt, x.target, options)).reply, /Conflict.*not launched/);
  assert.equal(await readFile(x.sourceFile, 'utf8'), '# Agent changed\n');
  assert.match((await handleAction({ prompt: 'bad' }, x.target, options)).reply, /Create PR failed/);
  assert.match((await handleAction(x.prompt, { ...x.target, pr: null }, options)).reply, /no recorded PR/);
  assert.equal(x.calls.length, 0);
});
test('missing target/space and app errors fail visibly after saving; no other terminal fallback', async t => {
  const x = await setup(t);
  for (const resolved of [null, { labels: {} }]) {
    await writeFile(x.sourceFile, original);
    const result = await handleAction(x.prompt, x.target, { run: x.run, resolve: async () => resolved });
    assert.match(result.reply, /Saved\. Create PR failed.*retarget/); assert.ok(result.notice);
  }
  assert.equal(x.calls.length, 0);
  for (const response of [new Error('app unavailable'), { stdout: '{"error":"unknown space"}' }, { stdout: '{"space":"wrong","tab":"t","terminal":"x"}' }]) {
    await writeFile(x.sourceFile, original);
    const result = await handleAction(x.prompt, x.target, { resolve: async () => terminal, run: async () => { if (response instanceof Error) throw response; return response; } });
    assert.match(result.reply, /Saved\. Create PR failed/); assert.ok(result.notice);
  }
});
test('fish command quoting preserves literal paths and revisions without executing input', () => {
  const values = ["a'b\\c $HOME ; (false)\n雪", '@-', 'foo|bar'];
  const script = 'printf "%s\\0" ' + values.map(fishQuote).join(' ');
  assert.deepEqual(execFileSync('fish', ['--no-config', '-c', script]).toString().split('\0').slice(0, -1), values);
});
test('pr CLI arguments and sidecar metadata', async t => {
  const x = await setup(t);
  assert.deepEqual(parseArgs(['pr', 'draft.md', '-r', '@-']), { target: 'draft.md', diff: false, pr: true, rev: '@-' });
  for (const args of [['pr'], ['pr', 'x.md', '--watch'], ['pr', 'x.md', '--git'], ['pr', 'x.md', '--from', '@-'], ['pr', 'x.md', '-r']]) assert.throws(() => parseArgs(args));
  const recorded = await recordTarget(x.page, { title: 'PR', sourceFile: x.sourceFile, pr: x.target.pr }, x.run);
  assert.deepEqual(recorded.pr, x.target.pr);
});
