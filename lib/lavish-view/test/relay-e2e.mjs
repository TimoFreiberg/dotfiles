// Run explicitly inside herdr: node lib/lavish-view/test/relay-e2e.mjs
// This creates and cleans up only its own scratch terminals and Lavish page.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { relayPaths } from '../src/relay.mjs';
const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, '../../../bin/lavish-view');
const session = `lavish-relay-e2e-${process.pid}`;
const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-relay-e2e-'));
const file = path.join(dir, 'page.html');
const terminals = []; let browser;
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
  await writeFile(file, '<!doctype html><html><head><title>Relay E2E</title></head><body><p id="context">Quoted E2E context</p></body></html>');
  const output = await run(process.execPath, [cli, file], { env: { ...process.env, HC_TERMINAL_ID: terminals[0] } });
  console.log(output.trim());
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
  await run('lavish-axi', ['end', file]);
  await until(async () => { try { await access(relayPaths(file).lock); return false; } catch { return true; } });
  console.log('PASS: browser queue-and-send, delivery, moved session, and relay exit');
} finally {
  if (browser) await browser.close();
  try { await exec('lavish-axi', ['end', file]); } catch {}
  try { process.kill(Number(await readFile(path.join(relayPaths(file).lock, 'pid'))), 'SIGTERM'); } catch {}
  for (const terminal of terminals) {
    try { await run('hc', ['kill', terminal]); } catch {}
    try { await run('hc', ['rm', terminal]); } catch {}
  }
  await rm(dir, { recursive: true, force: true });
}
