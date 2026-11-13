import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { writePRPage } from '../src/pr-page.mjs';
import { publishDocument } from '../src/document-page.mjs';
import { decodeAction } from '../src/action-message.mjs';
import { decodeSave } from '../src/save-message.mjs';
import { textHash } from '../src/save.mjs';

const root = path.resolve(import.meta.dirname, '..');
test('PR browser: hierarchy, preview, Save/Create PR envelopes, clean/dirty watch choices', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-pr-browser-')), dist = path.join(dir, 'dist'); await mkdir(dist);
  execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const source = path.join(dir, 'pr.md'); await writeFile(source, '# Original title\n\n## Body heading\n\n- [x] Done\n');
  const pr = { repo: '/example/repo', rev: '@-', head: 'a'.repeat(40), commits: ['abc123 Commit first line', '</script> literal metadata'] };
  const { file } = await writePRPage(source, dist, pr, { out: path.join(dir, 'page/index.html') });
  let browser;
  t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }), url = output.match(/url:\s*"?(https?:\/\/[^"\s]+)/)?.[1]; assert.ok(url, output);
  browser = await chromium.launch({ executablePath: process.env.LAVISH_VIEW_CHROMIUM || chromium.executablePath(), headless: true });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(url);
  const frame = page.locator('iframe').first().contentFrame(), title = frame.getByRole('textbox', { name: 'Title', exact: true }), body = frame.getByRole('textbox', { name: 'PR body' });
  await title.waitFor(); await frame.getByRole('status').filter({ hasText: 'Up to date with disk' }).waitFor();
  assert.equal(await title.inputValue(), 'Original title'); assert.match(await frame.locator('#repo').innerText(), /\/example\/repo/);
  assert.match(await frame.locator('#head').innerText(), /@-/);
  await frame.getByText('Commits at page creation', { exact: true }).click(); assert.match(await frame.locator('#commits').innerText(), /Commit first line/);
  await frame.getByRole('button', { name: 'Rendered', exact: true }).click(); await frame.getByRole('heading', { name: /^Body heading/ }).waitFor();
  await frame.getByRole('button', { name: 'Edit', exact: true }).click();
  await frame.locator('body').evaluate(() => {
    window.__messages = []; window.__sends = 0;
    const receive = window.lavishViewData;
    window.lavishViewData = data => { receive(data); window.__diskHash = data.hash; };
    window.lavish.queuePrompt = (prompt, options) => window.__messages.push({ prompt, ...options });
    window.lavish.sendQueuedPrompts = () => window.__sends++;
  });
  const mine = '# Edited title\n\nQuotes " \\ 雪\n\n';
  await title.fill('Edited title'); await body.fill('\nQuotes " \\ 雪\n\n');
  await body.press('Control+s');
  let messages = await frame.locator('body').evaluate(() => window.__messages);
  assert.equal(messages[0].tag, 'lavish-view-save'); assert.deepEqual(decodeSave(messages[0].prompt), { baseHash: textHash('# Original title\n\n## Body heading\n\n- [x] Done\n'), text: mine });
  await writeFile(source, '# External title\nNew body\n'); await publishDocument(file, source);
  await frame.getByRole('button', { name: 'Keep mine', exact: true }).waitFor(); assert.equal(await title.inputValue(), 'Edited title');
  await frame.getByRole('button', { name: 'Create PR', exact: true }).click();
  assert.equal(await frame.locator('body').evaluate(() => window.__messages.length), 1, 'pending conflict blocks action');
  await frame.getByRole('button', { name: 'Keep mine', exact: true }).click();
  await frame.getByRole('button', { name: 'Create PR', exact: true }).click();
  messages = await frame.locator('body').evaluate(() => window.__messages);
  assert.equal(messages[1].tag, 'lavish-view-action'); assert.deepEqual(decodeAction(messages[1].prompt).save, { baseHash: textHash('# External title\nNew body\n'), text: mine });
  await writeFile(source, mine); const savedHash = await publishDocument(file, source);
  // The status can describe an earlier update. Wait for this exact disk
  // revision before publishing another one, or the editor may skip its save.
  await until(
    async () => await frame.locator('body').evaluate((_body, hash) => window.__diskHash === hash, savedHash),
    async () => JSON.stringify(await frame.locator('body').evaluate(() => ({ hash: window.__diskHash, status: document.querySelector('#status').textContent }))),
  );
  await frame.getByRole('status').filter({ hasText: 'Up to date with disk' }).waitFor();
  await writeFile(source, '# Clean title\nClean body\n'); await publishDocument(file, source);
  await until(async () => await title.inputValue() === 'Clean title'); assert.equal(await body.inputValue(), 'Clean body\n');
  await title.fill('Dirty'); await writeFile(source, '# Reload title\nReload body\n'); await publishDocument(file, source);
  await frame.getByRole('button', { name: 'Reload (discard mine)', exact: true }).click();
  assert.equal(await title.inputValue(), 'Reload title'); assert.equal(await body.inputValue(), 'Reload body\n');
  assert.deepEqual(errors, []);
});
async function until(fn, diagnostic = async () => '') {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(`PR browser readiness timeout: ${await diagnostic()}`);
}
