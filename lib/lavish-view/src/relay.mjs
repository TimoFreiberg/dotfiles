import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite } from './files.mjs';
import { ensureDeps } from './deps.mjs';
import { handleSave } from './save.mjs';
import { saveTag } from './save-message.mjs';
import { actionTag } from './action-message.mjs';
import { handleAction } from './pr-action.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const worker = fileURLToPath(new URL('./relay-worker.mjs', import.meta.url));
export const relayPaths = file => ({ target: `${file}.relay.json`, outbox: `${file}.outbox.json`, lock: `${file}.relay.lock`, stateLock: `${file}.relay-state.lock` });
export function relayLog(file) {
  const id = createHash('sha256').update(file).digest('hex').slice(0, 16);
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'lavish-view', `relay-${id}.log`);
}
export async function command(name, args) {
  // Polls are indefinite, and hc send may be held while the user is typing.
  return exec(name, args, { maxBuffer: 32 * 1024 * 1024 });
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

// mkdir claims atomically. A separate reclaim directory serializes stale-lock
// removal, including a process dying between mkdir and writing its PID.
export async function claimLock(lock, { wait = false, timeout = 120000 } = {}) {
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      await mkdir(lock);
      try { await writeFile(path.join(lock, 'pid'), String(process.pid)); }
      catch (error) { await rm(lock, { recursive: true, force: true }); throw error; }
      return async () => { await rm(lock, { recursive: true, force: true }); };
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    let stale = false;
    try {
      const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'));
      stale = Number.isInteger(pid) && pid > 0 ? !alive(pid) : Date.now() - (await stat(lock)).mtimeMs > 5000;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { stale = Date.now() - (await stat(lock)).mtimeMs > 5000; }
      catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    }
    if (stale) {
      let modified;
      try { modified = (await stat(lock)).mtimeMs; }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const reclaim = path.join(lock, 'reclaim');
      try { await mkdir(reclaim); }
      catch (error) { if (['EEXIST', 'ENOENT'].includes(error.code)) { await pause(25); continue; } throw error; }
      let stillStale;
      try {
        const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'));
        stillStale = Number.isInteger(pid) && pid > 0 ? !alive(pid) : Date.now() - modified > 5000;
      }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        stillStale = Date.now() - modified > 5000;
      }
      if (stillStale) await rm(lock, { recursive: true, force: true });
      else await rm(reclaim, { recursive: true, force: true });
      continue;
    }
    if (!wait) return null;
    if (Date.now() >= deadline) throw new Error(`relay state is busy (${lock}); retry after delivery finishes`);
    await pause(25);
  }
}
async function withState(file, fn) {
  const release = await claimLock(relayPaths(file).stateLock, { wait: true });
  try { return await fn(); } finally { await release(); }
}
export async function liveTerminals(run = command) {
  const { stdout } = await run('hc', ['ls', '--json']);
  const result = JSON.parse(stdout);
  const terminals = Array.isArray(result) ? result : result.terminals;
  if (!Array.isArray(terminals)) throw new Error('hc ls returned no terminal list');
  const live = terminals.filter(t => t.state === 'live' && !t.rm);
  const detailed = await Promise.all(live.map(async terminal => {
    if (terminal.labels && Number.isFinite(terminal.created_ms)) return terminal;
    try { return JSON.parse((await run('hc', ['get', terminal.address, '--json'])).stdout); }
    catch { return null; } // A terminal can close between list and lookup.
  }));
  return detailed.filter(t => t?.state === 'live' && !t.rm);
}
function recorded(t, previous) {
  return { ...previous, terminal: t.address, session: t.labels?.['polytoken.session'] || null, space: t.labels?.['herdr.space'] || null };
}
export async function recordTarget(file, { title, sourceFile, pr } = {}, run = command) {
  file = await realpath(file);
  const { stdout } = await run('hc', ['get', process.env.HC_TERMINAL_ID, '--json']);
  const terminal = JSON.parse(stdout);
  if (terminal.state !== 'live' || !terminal.address) throw new Error('the opening herdr terminal is not live');
  const target = recorded(terminal, { version: 1, page: file, title, ...(sourceFile ? { sourceFile: path.resolve(sourceFile) } : {}), ...(pr ? { pr } : {}) });
  await withState(file, () => atomicWrite(relayPaths(file).target, JSON.stringify(target, null, 2) + '\n'));
  return target;
}
export function resolveTarget(target, terminals) {
  const matches = terminals.filter(t => target.session ? t.labels?.['polytoken.session'] === target.session : t.address === target.terminal);
  return matches.length === 1 ? matches[0] : null;
}
export function selectRetarget(target, terminals, terminal) {
  if (terminal) {
    const matches = terminals.filter(t => t.address === terminal || t.name === terminal);
    if (matches.length !== 1) throw new Error(`terminal ${terminal} is missing or ambiguous`);
    return matches[0];
  }
  if (!target.space) throw new Error('the page has no recorded herdr.space; pass --terminal T');
  const candidates = terminals.filter(t => t.labels?.['herdr.space'] === target.space && t.labels?.['polytoken.session']);
  if (!candidates.length) throw new Error('no live Polytoken terminal in the recorded herdr.space; pass --terminal T');
  if (candidates.some(t => !Number.isFinite(t.created_ms))) throw new Error('cannot determine the newest terminal; pass --terminal T');
  candidates.sort((a, b) => b.created_ms - a.created_ms);
  if (candidates[1]?.created_ms === candidates[0].created_ms) throw new Error('newest terminal is ambiguous; pass --terminal T');
  return candidates[0];
}
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export function formatMessage(target, batches) {
  const lines = [`Lavish feedback: ${target.title}\nPage: ${target.page}`];
  for (const batch of batches) {
    for (const prompt of batch.prompts || []) {
      const context = [prompt.tag && `Tag: ${prompt.tag}`, prompt.selector && `Selector: ${prompt.selector}`, prompt.text && `Quoted context:\n${String(prompt.text).split('\n').map(line => `> ${line}`).join('\n')}`, prompt.target && `Target: ${JSON.stringify(prompt.target)}`, prompt.attachments?.length && `Attachments: ${JSON.stringify(prompt.attachments)}`].filter(Boolean).join('\n');
      lines.push(`${context}${context ? '\n' : ''}${prompt.prompt || ''}`);
    }
    if (batch.artifact_failures?.length) lines.push(`Fatal artifact failures: ${JSON.stringify(batch.artifact_failures)}`);
    if (batch.session?.session_ended) lines.push('The user ended this review. Do not reopen it uninvited.');
    if (batch.rawOutput) lines.push(`Unparsed Lavish feedback (inspect before acting):\n${batch.rawOutput}`);
  }
  lines.push(`Answer on the page with lavish-axi reply ${quote(target.page)} --agent-reply '...'; do not poll this page (lavish-view owns its listener).`);
  return lines.join('\n\n');
}

// Later page kinds install handlers keyed by these tags. A handler receives
// (prompt, target) and returns { reply, notice? }; only its notice is forwarded.
// Save/action payloads never fall through as agent instructions.
export const handledTags = ['lavish-view-save', 'lavish-view-action'];
export async function dispatchPrompts(prompts, target, handlers = {}) {
  const forwarded = [], replies = [];
  for (const prompt of prompts) {
    if (!handledTags.includes(prompt.tag)) { forwarded.push(prompt); continue; }
    if (!handlers[prompt.tag]) { replies.push(`${prompt.tag} is not supported by this version of lavish-view. No file or action was changed.`); continue; }
    const result = await handlers[prompt.tag](prompt, target);
    if (result.reply) replies.push(result.reply);
    if (result.notice) forwarded.push({ prompt: result.notice });
  }
  return { prompts: forwarded, replies };
}
async function reply(file, text, run, log) {
  try { await run('lavish-axi', ['reply', file, '--agent-reply', text]); }
  catch (error) { log(`page reply failed: ${error.stderr?.trim() || error.message}`); }
}
async function flushLocked(file, target, run, log, replies = []) {
  const outbox = await json(relayPaths(file).outbox, []);
  if (!outbox.length) {
    if (replies.length) await reply(file, replies.join('\n'), run, log);
    return { delivered: 0 };
  }
  let terminal, failure;
  try {
    terminal = resolveTarget(target, await liveTerminals(run));
    if (terminal) await run('hc', ['send', terminal.address, formatMessage(target, outbox.map(item => item.feedback))]);
  } catch (error) { failure = error.stderr?.trim() || error.message; log(`delivery failed: ${failure}`); }
  if (!terminal || failure) {
    const text = `${failure ? 'Terminal delivery failed' : 'The recorded session or terminal is gone or ambiguous'}. Feedback is kept in ${relayPaths(file).outbox}. Retarget with lavish-view retarget ${quote(file)} [--terminal T].`;
    await reply(file, [...replies, text].join('\n'), run, log);
    return { delivered: 0, pending: outbox.length };
  }
  // Keep the outbox until hc accepts the send. A crash in this small window
  // can replay a batch, so delivery is at-least-once, not exactly-once.
  await atomicWrite(relayPaths(file).outbox, '[]\n');
  await reply(file, [...replies, `Delivered to ${target.session || terminal.address}`].join('\n'), run, log);
  return { delivered: outbox.length, terminal: terminal.address };
}
export async function deliverFeedback(file, feedback, { run = command, log = () => {}, handlers = {} } = {}) {
  return withState(file, async () => {
    const target = await json(relayPaths(file).target);
    const dispatched = await dispatchPrompts(feedback.prompts || [], target, handlers);
    const batch = { ...feedback, prompts: dispatched.prompts };
    if (batch.prompts.length || batch.artifact_failures?.length || batch.rawOutput) {
      const outbox = await json(relayPaths(file).outbox, []);
      outbox.push({ id: randomUUID(), receivedAt: new Date().toISOString(), feedback: batch });
      await atomicWrite(relayPaths(file).outbox, JSON.stringify(outbox, null, 2) + '\n');
    }
    return flushLocked(file, target, run, log, dispatched.replies);
  });
}
export async function retarget(file, terminal, { run = command, log = () => {} } = {}) {
  file = await realpath(file);
  return withState(file, async () => {
    const previous = await json(relayPaths(file).target);
    const next = recorded(selectRetarget(previous, await liveTerminals(run), terminal), previous);
    await atomicWrite(relayPaths(file).target, JSON.stringify(next, null, 2) + '\n');
    return { target: next, ...await flushLocked(file, next, run, log) };
  });
}
export async function ensureRelay(file) {
  const log = relayLog(file);
  await mkdir(path.dirname(log), { recursive: true });
  const output = await open(log, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [worker, file], { detached: true, stdio: ['ignore', output.fd, output.fd, 'ipc'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`relay startup timed out; see ${log}`)); }, 10000);
      const done = error => { clearTimeout(timer); child.removeAllListeners('exit'); if (child.connected) child.disconnect(); child.unref(); error ? reject(error) : resolve(); };
      child.once('error', done);
      child.once('exit', code => done(new Error(`relay exited before startup (${code}); see ${log}`)));
      child.once('message', result => done(result.error ? new Error(`${result.error}; see ${log}`) : undefined));
    });
  } finally { await output.close(); }
}
export async function pollLoop(file, { run = command, decode, deliver = deliverFeedback, log = () => {}, sleep = pause, signal } = {}) {
  let failures = 0;
  while (!signal?.aborted) {
    let feedback;
    try {
      const { stdout } = await run('lavish-axi', ['poll', file, '--owner', `lavish-view:${file}`]);
      try { feedback = decode(stdout); }
      catch (error) {
        await deliver(file, { rawOutput: stdout }, { run, log });
        throw new Error(`could not decode poll output: ${error.message}`);
      }
    } catch (error) {
      const text = error.stderr?.trim() || error.message;
      log(`poll failed: ${text}`);
      if (signal?.aborted || /LISTENER_REPLACED|NOT_FOUND/.test(text)) return;
      await sleep(Math.min(30000, 500 * 2 ** Math.min(failures++, 6)));
      continue;
    }
    if (feedback.prompts?.length || feedback.artifact_failures?.length) {
      // Once poll consumes a response, retry persistence/delivery rather than
      // polling again and forgetting that response.
      while (!signal?.aborted) {
        try { await deliver(file, feedback, { run, log }); break; }
        catch (error) { log(`feedback persistence failed: ${error.message}`); await sleep(1000); }
      }
    }
    if (feedback.session?.status === 'ended' || feedback.session?.session_ended || feedback.artifact_failures?.length) return;
    if (feedback.session?.status !== 'feedback') await sleep(Math.min(30000, 500 * 2 ** Math.min(failures++, 6)));
    else failures = 0;
  }
}
export async function relayMain(file) {
  const log = message => console.error(`${new Date().toISOString()} ${message}`);
  let release;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    release = await claimLock(relayPaths(file).lock);
    if (!release) { if (process.connected) process.send({ running: true }); return; }
    const deps = await ensureDeps();
    const { decode } = await import(pathToFileURL(deps.resolve('@toon-format/toon')).href);
    if (process.connected) process.send({ running: true });
    log(`relay started for ${file} (pid ${process.pid})`);
    const run = (name, args) => exec(name, args, { maxBuffer: 32 * 1024 * 1024, signal: controller.signal });
    const sleep = async ms => { try { await delay(ms, undefined, { signal: controller.signal }); } catch (error) { if (error.name !== 'AbortError') throw error; } };
    // Finish durable deliveries left behind by a prior crashed relay.
    await withState(file, async () => flushLocked(file, await json(relayPaths(file).target), run, log));
    await pollLoop(file, { run, decode, log, sleep, signal: controller.signal,
      deliver: (page, feedback, options) => deliverFeedback(page, feedback, { ...options, handlers: {
        [saveTag]: handleSave,
        [actionTag]: (prompt, target) => handleAction(prompt, target, { run, resolve: async () => resolveTarget(target, await liveTerminals(run)) }),
      } }),
    });
    log('relay stopped');
  } catch (error) { if (process.connected) process.send({ error: error.message }); log(error.stack || error.message); process.exitCode = 1; }
  finally { if (release) await release(); process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
