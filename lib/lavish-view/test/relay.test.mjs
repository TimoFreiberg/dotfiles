import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, chmod, rm, access, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { claimLock, deliverFeedback, dispatchPrompts, formatMessage, liveTerminals, pollLoop, recordTarget, relayPaths, resolveTarget, retarget, selectRetarget } from '../src/relay.mjs';
import { parseArgs } from '../src/cli.mjs';
const exec = promisify(execFile);
const terminal = (address, session = 'session-a', space = 'space-a', created_ms = 1) => ({ address, state: 'live', created_ms, labels: { 'polytoken.session': session, 'herdr.space': space } });
async function setup(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lavish-relay-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'page.html'); await writeFile(file, '<title>Relay test</title>');
  const target = { version: 1, page: file, title: 'Relay test', terminal: 't1', session: 'session-a', space: 'space-a' };
  await writeFile(relayPaths(file).target, JSON.stringify(target));
  const calls = []; let terminals = [terminal('t1')], sendFails = false, replyFails = false;
  const run = async (name, args) => {
    calls.push([name, ...args]);
    if (name === 'hc') {
      if (args[0] === 'ls') return { stdout: JSON.stringify(terminals) };
      if (args[0] === 'get') return { stdout: JSON.stringify(terminals[0]) };
      if (sendFails) throw new Error('send failed');
    }
    if (name === 'lavish-axi' && replyFails) throw new Error('reply failed');
    return { stdout: '' };
  };
  return { dir, file, target, calls, run, setTerminals: value => terminals = value, failSend: value => sendFails = value, failReply: value => replyFails = value };
}
const feedback = { session: { status: 'feedback' }, prompts: [{ prompt: 'Change this line\nKeep the context.', tag: 'code-comment', text: 'old line\nnext line', target: { path: 'x.mjs', side: 'new' } }] };

test('records target labels, canonical page, title, and optional editable source', async t => {
  const x = await setup(t); const target = await recordTarget(x.file, { title: 'Recorded', sourceFile: path.join(x.dir, 'source.md') }, x.run);
  assert.deepEqual(target, { ...x.target, title: 'Recorded', sourceFile: path.join(x.dir, 'source.md') });
  assert.deepEqual(JSON.parse(await readFile(relayPaths(x.file).target)), target);
  assert.equal(x.calls[0][1], 'get');
});
test('hc summary rows are hydrated for labels/timestamps; closed terminals are skipped', async () => {
  const calls = [];
  const result = await liveTerminals(async (name, args) => {
    calls.push(args);
    if (args[0] === 'ls') return { stdout: JSON.stringify({ terminals: [{ address: 't1', state: 'live' }, { address: 't2', state: 'live' }, { address: 't3', state: 'finished' }] }) };
    if (args[1] === 't2') throw new Error('terminal closed');
    return { stdout: JSON.stringify(terminal('t1')) };
  });
  assert.deepEqual(result, [terminal('t1')]); assert.equal(calls.length, 3);
});
test('session resolution follows moved session, never falls back to reused terminal', () => {
  const target = { terminal: 't1', session: 'session-a' };
  assert.equal(resolveTarget(target, [terminal('t1', 'other'), terminal('t2')]).address, 't2');
  assert.equal(resolveTarget(target, [terminal('t1', 'other')]), null);
  assert.equal(resolveTarget(target, [terminal('t1'), terminal('t2')]), null);
  assert.equal(resolveTarget({ terminal: 't1', session: null }, [terminal('t1', 'other')]).address, 't1');
});
test('one message includes page, all text/quoted context, target, attachments, and reply instruction', () => {
  const text = formatMessage({ title: 'Title', page: "/tmp/a'b.html" }, [feedback, { prompts: [{ prompt: 'Second', attachments: [{ path: '/tmp/image.png' }] }] }]);
  assert.match(text, /Title\nPage: \/tmp\/a'b.html/); assert.match(text, /> old line\n> next line/);
  assert.match(text, /Change this line\nKeep the context/); assert.match(text, /Second/); assert.match(text, /Attachments:.*image.png/);
  assert.match(text, /"side":"new"/); assert.match(text, /lavish-axi reply '\/tmp\/a'\\''b.html'/); assert.match(text, /do not poll/);
});
test('missing target persists batches, retarget flushes once to newest same-space session', async t => {
  const x = await setup(t); x.setTerminals([]);
  await deliverFeedback(x.file, feedback, { run: x.run }); await deliverFeedback(x.file, { prompts: [{ prompt: 'Another batch' }] }, { run: x.run });
  assert.equal(JSON.parse(await readFile(relayPaths(x.file).outbox)).length, 2);
  assert.equal(x.calls.filter(c => c[1] === 'send').length, 0); assert.match(x.calls.at(-1).at(-1), /gone or ambiguous.*outbox.*retarget/);
  x.setTerminals([terminal('t9', 'old', 'space-a', 2), terminal('t10', 'new', 'space-a', 3), terminal('t11', 'elsewhere', 'space-b', 4)]);
  const result = await retarget(x.file, undefined, { run: x.run }); assert.equal(result.delivered, 2); assert.equal(result.target.session, 'new');
  const sends = x.calls.filter(c => c[1] === 'send'); assert.equal(sends.length, 1); assert.equal(sends[0][2], 't10'); assert.match(sends[0][3], /Another batch/);
  assert.deepEqual(JSON.parse(await readFile(relayPaths(x.file).outbox)), []);
  assert.match(x.calls.at(-1).at(-1), /Delivered to new/);
});
test('failed send retains feedback; explicit retarget works while old target is live', async t => {
  const x = await setup(t); x.failSend(true); await deliverFeedback(x.file, feedback, { run: x.run });
  assert.equal(JSON.parse(await readFile(relayPaths(x.file).outbox)).length, 1); assert.match(x.calls.at(-1).at(-1), /delivery failed/i);
  x.failSend(false); x.setTerminals([terminal('t1'), terminal('t2', 'session-b')]);
  await retarget(x.file, 't2', { run: x.run }); assert.equal(x.calls.filter(c => c[1] === 'send').at(-1)[2], 't2');
  await deliverFeedback(x.file, feedback, { run: x.run }); assert.equal(x.calls.filter(c => c[1] === 'send').at(-1)[2], 't2');
});
test('reply failure logs without replaying an accepted send', async t => {
  const x = await setup(t); const logs = []; x.failReply(true);
  const result = await deliverFeedback(x.file, feedback, { run: x.run, log: message => logs.push(message) });
  assert.equal(result.delivered, 1); assert.deepEqual(JSON.parse(await readFile(relayPaths(x.file).outbox)), []); assert.match(logs[0], /reply failed/);
});
test('retarget rejects missing, ambiguous, unlabeled defaults, and tied newest targets', () => {
  const target = { space: 'space-a' };
  assert.throws(() => selectRetarget(target, [], undefined), /no live/);
  assert.throws(() => selectRetarget({}, [terminal('t1')]), /no recorded/);
  assert.throws(() => selectRetarget(target, [terminal('t1', '')]), /no live/);
  assert.throws(() => selectRetarget(target, [terminal('t1'), terminal('t2')]), /ambiguous/);
  assert.throws(() => selectRetarget(target, [terminal('t1')], 't9'), /missing/);
  assert.deepEqual(parseArgs(['retarget', '/tmp/page.html', '--terminal', 't2']), { retarget: true, page: '/tmp/page.html', terminal: 't2' });
  assert.throws(() => parseArgs(['retarget']), /requires/); assert.throws(() => parseArgs(['retarget', 'x', '--bad']), /only/);
});
test('concurrent delivery and retarget preserve all batches', async t => {
  const x = await setup(t); x.setTerminals([]);
  await Promise.all(Array.from({ length: 5 }, (_, i) => deliverFeedback(x.file, { prompts: [{ prompt: `batch-${i}` }] }, { run: x.run })));
  assert.equal(JSON.parse(await readFile(relayPaths(x.file).outbox)).length, 5);
  x.setTerminals([terminal('t2', 'session-b')]);
  await Promise.all([retarget(x.file, 't2', { run: x.run }), deliverFeedback(x.file, feedback, { run: x.run })]);
  const sent = x.calls.filter(c => c[1] === 'send').map(c => c[3]).join('\n');
  for (let i = 0; i < 5; i++) assert.equal(sent.split(`batch-${i}`).length, 2);
  assert.deepEqual(JSON.parse(await readFile(relayPaths(x.file).outbox)), []);
});
test('save/action hooks are reserved, return notices only, and do not implement changes', async () => {
  const prompts = [{ tag: 'lavish-view-save', prompt: 'private file content' }, { tag: 'lavish-view-action', prompt: 'launch something' }, { prompt: 'comment' }];
  const unsupported = await dispatchPrompts(prompts, {}); assert.deepEqual(unsupported.prompts, [prompts[2]]); assert.equal(unsupported.replies.length, 2);
  const handled = await dispatchPrompts(prompts, {}, { 'lavish-view-save': async () => ({ reply: 'Saved', notice: 'User edited source.md; reread it.' }) });
  assert.deepEqual(handled.prompts, [{ prompt: 'User edited source.md; reread it.' }, prompts[2]]);
});
test('poll handles actual TOON, retries disconnect/crash/listener conflict, exits after final feedback', async () => {
  const responses = [new Error('crash'), { session: { status: 'browser_disconnected' } }, new Error('LISTENER_ACTIVE'), { ...feedback, session: { status: 'feedback', session_ended: true } }];
  const calls = [], delivered = [], sleeps = [];
  await pollLoop('/tmp/test.html', { decode, run: async (name, args) => { calls.push([name, ...args]); const next = responses.shift(); if (next instanceof Error) throw next; return { stdout: encode(next) }; }, deliver: async (file, data) => delivered.push(data), sleep: async ms => sleeps.push(ms) });
  assert.equal(calls.length, 4); assert.equal(delivered.length, 1); assert.equal(delivered[0].session.session_ended, true);
  assert.deepEqual(sleeps, [500, 1000, 2000]); assert.ok(calls.every(c => c.includes('--owner') && !c.includes('--takeover')));
});
test('plain session end and artifact failures terminate relay loop', async () => {
  for (const response of [{ session: { status: 'ended' } }, { session: { status: 'feedback' }, artifact_failures: [{ kind: 'fatal', detail: 'broken' }] }]) {
    let polls = 0, deliveries = 0;
    await pollLoop('x', { decode, run: async () => { assert.equal(++polls, 1); return { stdout: encode(response) }; }, deliver: async () => deliveries++ });
    assert.equal(polls, 1); assert.equal(deliveries, response.artifact_failures ? 1 : 0);
  }
});
test('listener replacement stops and persistence failure retries the consumed batch', async () => {
  let polls = 0, attempts = 0;
  await pollLoop('x', { decode, run: async () => { polls++; throw new Error('LISTENER_REPLACED'); }, sleep: async () => assert.fail('must stop') }); assert.equal(polls, 1);
  polls = 0;
  await pollLoop('x', { decode, run: async () => { polls++; return { stdout: encode({ ...feedback, session: { session_ended: true } }) }; }, deliver: async () => { if (++attempts === 1) throw new Error('disk busy'); }, sleep: async () => {} });
  assert.equal(polls, 1); assert.equal(attempts, 2);
});
test('undecodable consumed output retries persistence before another poll', async () => {
  let polls = 0, attempts = 0;
  const controller = new AbortController();
  await pollLoop('x', { signal: controller.signal, decode: () => { throw new Error('bad TOON'); },
    run: async () => { assert.equal(++polls, 1); return { stdout: 'consumed raw feedback' }; },
    deliver: async (file, data) => { assert.equal(data.rawOutput, 'consumed raw feedback'); if (++attempts === 1) throw new Error('disk busy'); controller.abort(); }, sleep: async () => {} });
  assert.equal(polls, 1); assert.equal(attempts, 2);
});
test('crashed reclaimers recover and every busy path observes the deadline', async t => {
  const x = await setup(t), lock = relayPaths(x.file).lock, reclaim = path.join(lock, 'reclaim');
  for (const pid of ['2147483647', null]) {
    await mkdir(reclaim, { recursive: true }); await writeFile(path.join(lock, 'pid'), '2147483647');
    if (pid) await writeFile(path.join(reclaim, 'pid'), pid);
    else await utimes(reclaim, new Date(0), new Date(0));
    const release = await claimLock(lock, { wait: true, timeout: 500 }); assert.ok(release); await release();
  }
  await mkdir(reclaim, { recursive: true }); await writeFile(path.join(lock, 'pid'), '2147483647');
  await writeFile(path.join(reclaim, 'pid'), String(process.pid));
  const start = Date.now();
  await assert.rejects(claimLock(lock, { wait: true, timeout: 50 }), /state is busy/);
  assert.ok(Date.now() - start < 1000); assert.equal(await claimLock(lock), null);
  await rm(lock, { recursive: true });
  const release = await claimLock(lock);
  await assert.rejects(claimLock(lock, { wait: true, timeout: 50 }), /state is busy/);
  await release();
});
test('per-page lock excludes simultaneous callers and reclaims dead PID', async t => {
  const x = await setup(t); const lock = relayPaths(x.file).lock;
  const results = await Promise.all(Array.from({ length: 8 }, () => claimLock(lock))); assert.equal(results.filter(Boolean).length, 1);
  await results.find(Boolean)(); await mkdir(lock); await writeFile(path.join(lock, 'pid'), '2147483647');
  const release = await claimLock(lock); assert.ok(release); await release(); await assert.rejects(access(lock));
  await mkdir(lock); await utimes(lock, new Date(0), new Date(0));
  const missingPid = await claimLock(lock); assert.ok(missingPid); await missingPid();
  await mkdir(lock); await writeFile(path.join(lock, 'pid'), '');
  assert.equal(await claimLock(lock), null, 'a fresh PID file can be mid-write');
  await utimes(lock, new Date(0), new Date(0));
  const emptyPid = await claimLock(lock); assert.ok(emptyPid); await emptyPid();
});
test('hc/lavish subprocess stubs record metadata and deliver without a shell', async t => {
  const x = await setup(t); const bin = path.join(x.dir, 'bin'); await mkdir(bin);
  const log = path.join(x.dir, 'calls');
  for (const name of ['hc', 'lavish-axi']) {
    const body = `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)},...args])+'\\n'); if(args[0]==='get') console.log(${JSON.stringify(JSON.stringify(terminal('t1')))}); if(args[0]==='ls') console.log(${JSON.stringify(JSON.stringify([terminal('t2')]))});\n`;
    await writeFile(path.join(bin, name), body); await chmod(path.join(bin, name), 0o755);
  }
  const run = (name, args) => exec(path.join(bin, name), args);
  await recordTarget(x.file, { title: 'Subprocess' }, run); await deliverFeedback(x.file, feedback, { run });
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.find(c => c[1] === 'send')[2], 't2'); assert.match(calls.at(-1).at(-1), /Delivered to session-a/);
});
test('detached relay starts once, survives its caller, exits on stub session end', async t => {
  const x = await setup(t); const bin = path.join(x.dir, 'bin'); await mkdir(bin);
  const stop = path.join(x.dir, 'stop'), calls = path.join(x.dir, 'polls');
  await writeFile(path.join(bin, 'hc'), `#!${process.execPath}\nconsole.log('[]');\n`); await chmod(path.join(bin, 'hc'), 0o755);
  await writeFile(path.join(bin, 'lavish-axi'), `#!${process.execPath}\nconst fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ')+'\\n'); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})){clearInterval(timer); console.log('session:\\n  status: ended');}},20);\n`); await chmod(path.join(bin, 'lavish-axi'), 0o755);
  const module = fileURLToPath(new URL('../src/relay.mjs', import.meta.url));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: path.join(x.dir, 'state') };
  const launch = () => exec(process.execPath, ['--input-type=module', '-e', `import {ensureRelay} from ${JSON.stringify(module)}; await ensureRelay(${JSON.stringify(x.file)});`], { env });
  const until = async fn => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('relay lifecycle timeout'); };
  t.after(async () => { try { process.kill(Number(await readFile(path.join(relayPaths(x.file).lock, 'pid'))), 'SIGTERM'); } catch {} });
  await Promise.all([launch(), launch(), launch()]);
  await until(async () => { try { return Boolean(await readFile(calls, 'utf8')); } catch { return false; } });
  const pid = Number(await readFile(path.join(relayPaths(x.file).lock, 'pid'))); assert.ok(pid); process.kill(pid, 0);
  await launch(); assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 1);
  await writeFile(stop, 'end'); await until(async () => { try { await access(relayPaths(x.file).lock); return false; } catch { return true; } });
  await rm(stop); await launch();
  await until(async () => (await readFile(calls, 'utf8')).trim().split('\n').length === 2);
  process.kill(Number(await readFile(path.join(relayPaths(x.file).lock, 'pid'))), 'SIGTERM');
  await until(async () => { try { await access(relayPaths(x.file).lock); return false; } catch { return true; } });
});
