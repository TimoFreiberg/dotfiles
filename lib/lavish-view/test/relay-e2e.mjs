// Run explicitly inside herdr: node lib/lavish-view/test/relay-e2e.mjs
// This creates and cleans up only its own scratch terminals and Lavish page.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { relayPaths, relayLog } from '../src/relay.mjs';
const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, '../../../bin/lavish-view');
const session = `lavish-relay-e2e-${process.pid}`;
const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-relay-e2e-'));
const file = path.join(dir, 'page.html');
const sourceFile = path.join(dir, 'task.md');
const terminals = []; let browser, watcher;
let watcherOutput = '', watcherErrors = '';
const run = async (name, args, options = {}) => {
  const result = await exec(name, args, { ...options, maxBuffer: 4 * 1024 * 1024 });
  console.log(`$ ${name === process.execPath ? 'node' : name} ${args.join(' ')}`);
  return result.stdout;
};
const until = async fn => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('E2E readiness timeout');
};
try {
  for (const label of [session, `${session}-spare`]) {
    const result = JSON.parse(await run('hc', ['run', '--bg', '--no-parent', '--no-notify', '--label', `polytoken.session=${label}`, '--label', `herdr.space=${session}`, 'cat']));
    terminals.push(result.address); console.log(`Created scratch terminal ${result.address}`);
  }
  await writeFile(sourceFile, '# Relay E2E\n\nQuoted E2E context\n');
  console.log(`$ node ${cli} task ${sourceFile} --out ${file} --title Relay E2E`);
  watcher = spawn(process.execPath, [cli, 'task', sourceFile, '--out', file, '--title', 'Relay E2E'], { env: { ...process.env, HC_TERMINAL_ID: terminals[0] } });
  watcher.stdout.setEncoding('utf8'); watcher.stderr.setEncoding('utf8');
  watcher.stdout.on('data', chunk => watcherOutput += chunk); watcher.stderr.on('data', chunk => watcherErrors += chunk);
  await until(() => watcherOutput.includes('Lavish review'));
  console.log(watcherOutput.trim());
  assert.equal(JSON.parse(await readFile(relayPaths(file).target)).sourceFile, await realpath(sourceFile));
  // Querying open's URL does not create a second poll listener.
  const opened = await run('lavish-axi', [file, '--no-open']);
  const url = opened.match(/url:\s*"?(https?:\/\/[^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({ executablePath: process.env.LAVISH_VIEW_CHROMIUM || chromium.executablePath(), headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => console.log(`Browser error: ${error.message}`));
  page.on('response', response => { if (response.request().method() === 'POST') console.log(`Browser POST ${new URL(response.url()).pathname}: ${response.status()}`); });
  await page.goto(url);
  const frame = page.frames().find(frame => frame !== page.mainFrame()); assert.ok(frame);
  await frame.waitForFunction(() => typeof window.lavish?.sendQueuedPrompts === 'function');
  for (const [index, text] of [[0, 'relay-e2e-first-comment'], [1, 'relay-e2e-moved-comment']]) {
    if (index) {
      await run('hc', ['label', terminals[0], `polytoken.session=${session}-retired`]);
      await run('hc', ['label', terminals[1], `polytoken.session=${session}`]);
    }
    await frame.evaluate(text => {
      window.lavish.queuePrompt(text, { tag: 'code-comment', text: 'Quoted E2E context', target: { path: 'example.md', line: 1 } });
      window.lavish.sendQueuedPrompts();
    }, text);
    let screen;
    try { await until(async () => { screen = (await exec('hc', ['read', terminals[index]])).stdout; return screen.includes(text); }); }
    catch (error) { console.log(`Conversation on failure:\n${await page.locator('body').innerText()}\nTerminal screen:\n${screen}`); throw error; }
    assert.match(screen, /Quoted E2E context/); assert.match(screen, /do not poll this page/);
    console.log(`hc read ${terminals[index]} confirmed ${text}:\n${screen.trim()}`);
    if (index) assert.ok(!(await exec('hc', ['read', terminals[0]])).stdout.includes(text), 'moved delivery must not reach the old terminal');
  }
  const editor = frame.getByRole('textbox', { name: 'Markdown text' });
  await until(async () => (await editor.inputValue()).includes('Quoted E2E context'));
  const saved = '# Saved from task page\n\n' + ('Odd " \\ Context data: </script> 雪 🦊\u2028\n').repeat(20000);
  await editor.fill('# Saved from task page\n');
  await editor.evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, saved);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => await readFile(sourceFile, 'utf8') === saved);
  let notice;
  await until(async () => { notice = (await exec('hc', ['read', terminals[1]])).stdout; return notice.includes('The user edited') && notice.includes(sourceFile); });
  assert.ok(!notice.includes('Odd "'), 'full save contents must not reach the agent');
  await until(async () => (await frame.getByRole('status').innerText()).includes('Up to date with disk'));
  assert.equal(await editor.inputValue(), saved);
  console.log(`PASS: Save button wrote ${Buffer.byteLength(saved)} UTF-8 bytes exactly; watched page updated without reload.`);
  console.log(`hc read ${terminals[1]} confirmed short save notice:\n${notice.trim()}`);
  await run('lavish-axi', ['end', file]);
  await until(async () => { try { await access(relayPaths(file).lock); return false; } catch { return true; } });
  console.log('PASS: browser queue-and-send, delivery, moved session, and relay exit');
} finally {
  if (watcherErrors) console.log(`Task watcher stderr: ${watcherErrors.trim()}`);
  if (watcher && watcher.exitCode === null) {
    const stopped = new Promise(resolve => watcher.once('close', resolve));
    watcher.kill('SIGTERM'); await stopped;
  }
  if (browser) await browser.close();
  try { await exec('lavish-axi', ['end', file]); } catch {}
  try {
    process.kill(Number(await readFile(path.join(relayPaths(file).lock, 'pid'))), 'SIGTERM');
    await until(async () => { try { await access(relayPaths(file).lock); return false; } catch { return true; } });
  } catch {}
  try { await rm(relayLog(await realpath(file)), { force: true }); } catch {}
  for (const terminal of terminals) {
    try { await run('hc', ['kill', terminal]); } catch {}
    try { await run('hc', ['rm', terminal]); } catch {}
  }
  await rm(dir, { recursive: true, force: true });
}
