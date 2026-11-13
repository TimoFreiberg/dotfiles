import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parsePR, serializePR } from '../src/pr-format.mjs';
import { decodeAction, encodeCreatePR, actionTag } from '../src/action-message.mjs';
import { handleAction, fishQuote } from '../src/pr-action.mjs';
import { textHash } from '../src/save.mjs';
import { deliverFeedback, relayPaths, recordTarget } from '../src/relay.mjs';
import { parseArgs } from '../src/cli.mjs';
import { execFileSync } from 'node:child_process';

const original = '# Original\n\nOriginal body\n';
const mine = '# New "title" 雪\n\nBody \' \\ $HOME ; (exit)\n\nContext data:\n</script>\n\n';
const terminal = { address: 'scratch-moved', state: 'live', created_ms: 1, labels: { 'herdr.space': 'space-moved', 'polytoken.session': 'scratch' } };
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-pr-'));
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
test('versioned action embeds the same validated save; rejects unsupported and malformed payloads', () => {
  assert.equal(decodeAction(encodeCreatePR(textHash(original), mine)).action, 'create-pr');
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
