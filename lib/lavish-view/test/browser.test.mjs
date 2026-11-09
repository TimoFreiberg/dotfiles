import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { writeDiffPage } from '../src/diff/page.mjs';

const root = path.resolve(import.meta.dirname, '..');
const executablePath = process.env.LAVISH_VIEW_CHROMIUM || chromium.executablePath();
const patch = 'diff --git a/old name.js b/example.js\nsimilarity index 50%\nrename from old name.js\nrename to example.js\nindex 1111111..2222222 100644\n--- a/old name.js\n+++ b/example.js\n@@ -1,3 +1,3 @@\n-const old = 1;\n+const newer = "</script><img src=x onerror=alert(1)>";\n---old\n+++new\n console.log(newer);\n';
const source = { root: '/tmp/test repo', kind: 'jj', to: '@', range: 'test range', rangeSource: 'test', rangeSpec: 'test', revision: 'abc123', commits: ['abc123 test'], generated: 'now', patch };

test('real Lavish offline browser smoke', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-browser-')); const dist = path.join(dir, 'dist'); await mkdir(dist);
  execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const { file } = await writeDiffPage(source, dist, path.join(dir, 'page/index.html'));
  let browser; t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }); const url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url, output);
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.stack)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => { const url = new URL(route.request().url()); return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? route.continue() : route.abort(); });
  await page.goto(url); const iframe = page.locator('iframe').first(); await iframe.waitFor(); const frame = iframe.contentFrame();
  await frame.getByRole('heading', { name: 'Files (1)' }).waitFor({ timeout: 20000 }); await frame.getByText('example.js').first().waitFor(); assert.match(await frame.locator('.sidebar').innerText(), /\+2 −2/);
  await frame.locator('[data-content] [data-line-type="change-addition"] span[style]').first().waitFor({ timeout: 20000 });
  assert.equal(await frame.getByRole('link', { name: /Open in Zed/ }).getAttribute('href'), 'zed://file//tmp/test%20repo/example.js:1');
  assert.equal(await frame.getByRole('link', { name: /Open in Zed/ }).getAttribute('target'), '_blank');
  await frame.getByRole('button', { name: 'Split', exact: true }).click(); assert.equal(await frame.getByRole('button', { name: 'Unified', exact: true }).count(), 1);
  await frame.getByRole('button', { name: 'Unified', exact: true }).click();
  await frame.getByRole('checkbox', { name: 'Viewed' }).check(); assert.match(await frame.locator('.sidebar').innerText(), /✓/);
  await frame.locator('body').evaluate(() => document.activeElement?.blur()); await frame.locator('body').press('v'); assert.doesNotMatch(await frame.locator('.sidebar').innerText(), /✓/); await frame.locator('body').press('v'); assert.match(await frame.locator('.sidebar').innerText(), /✓/);
  await frame.locator('body').evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window.__copied = text; } } })); await frame.getByRole('button', { name: 'Copy Zed command' }).click(); assert.equal(await frame.locator('body').evaluate(() => window.__copied), "zed '/tmp/test repo/example.js:1'");
  await frame.getByRole('button', { name: '▼' }).click(); await frame.getByRole('button', { name: '▶' }).waitFor({ timeout: 5000 }); assert.equal(await frame.locator('[data-content] [data-line]').count(), 0); await frame.getByRole('button', { name: '▶' }).click(); await frame.locator('[data-content] [data-line]').first().waitFor();
  await frame.locator('body').evaluate(() => document.activeElement?.blur()); await frame.locator('body').press('s'); assert.equal(await frame.getByRole('button', { name: 'Unified', exact: true }).count(), 1); await frame.locator('body').press('s');
  await frame.locator('body').press('?'); assert.equal(await frame.locator('.help').isVisible(), true); await frame.locator('body').press('?');
  await frame.locator('body').press('n'); await frame.locator('body').press('p'); await frame.locator('body').press('j'); await frame.locator('body').press('k');
  assert.equal(await frame.getByText('Viewed resets on reload').count(), 1);
  assert.match(await frame.locator('[data-content]').innerText(), /<\/script><img/);
  await frame.locator('[data-gutter] [data-line-type="change-deletion"]').first().click();
  await frame.getByPlaceholder('Write a comment').waitFor({ timeout: 5000 });
  const draft = frame.getByPlaceholder('Write a comment'); await draft.press('j'); assert.equal(await draft.inputValue(), 'j');
  const poll = spawn('lavish-axi', ['poll', file, '--timeout-ms', '15000']); let pollOutput = ''; poll.stdout.on('data', chunk => pollOutput += chunk); const pollDone = new Promise((resolve, reject) => { poll.on('error', reject); poll.on('close', resolve); });
  t.after(() => poll.kill());
  await frame.locator('body').evaluate(() => { window.__identity = Math.random(); }); const identity = await frame.locator('body').evaluate(() => window.__identity);
  await writeDiffPage({ ...source, patch: patch.replace('newer', 'changed') }, dist, file);
  await frame.getByText('Diff changed').waitFor({ timeout: 8000 }); assert.equal(await frame.getByRole('button', { name: 'Refresh' }).isDisabled(), true);
  await frame.getByRole('button', { name: 'Queue comment' }).click();
  await frame.getByRole('button', { name: 'Refresh' }).click(); await frame.locator('[data-content]').getByText(/changed/).first().waitFor({ timeout: 10000 });
  assert.equal(await frame.locator('body').evaluate(() => window.__identity), identity);
  await page.getByRole('button', { name: 'Send to Agent' }).click(); await pollDone; assert.match(pollOutput, /code-comment/); assert.match(pollOutput, /old old name.js:1/); assert.match(pollOutput, /abc123/); assert.match(pollOutput, /const old/);
  assert.deepEqual(errors, []);
});

test('keyboard navigates files and hunks in both directions', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-nav-')); const dist = path.join(dir, 'dist'); await mkdir(dist); execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const hunk = line => `@@ -${line} +${line} @@\n-old${line}\n+new${line}\n`;
  const part = (name, lines) => `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n${lines.map(hunk).join('')}`;
  const { file } = await writeDiffPage({ ...source, patch: part('first.js',[1,50]) + part('second.js',[1,50]) + part('third.js',[1]) }, dist, path.join(dir, 'page/index.html')); let browser;
  t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], {stdio:'ignore'}); } catch {} await rm(dir,{recursive:true,force:true}); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], {encoding:'utf8'}); const url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({executablePath, headless:true}); const page = await browser.newPage({viewport:{width:900,height:400}});
  await page.addInitScript(() => { const data = new Map(); Object.defineProperty(window, 'localStorage', { configurable:true, value:{ getItem:key => data.get(key) ?? null, setItem:(key,value) => data.set(key,value) } }); });
  await page.goto(url); const frame = page.locator('iframe').first().contentFrame(); await frame.getByRole('heading', {name:'Files (3)'}).waitFor();
  assert.equal(await frame.getByText('Viewed resets on reload').count(), 0); await frame.locator('[data-file="first.js"]').getByRole('checkbox', {name:'Viewed'}).check(); assert.match(await frame.locator('body').evaluate(() => localStorage.getItem('lavish-view-viewed')), /first\.js/);
  const body = frame.locator('body'); await body.evaluate(() => { const view = window.__INSTANCE, original = view.scrollTo.bind(view); window.__targets = []; view.scrollTo = target => { window.__targets.push(target); return original(target); }; });
  const target = () => body.evaluate(() => window.__targets.at(-1));
  await frame.getByRole('button', {name:/second\.js \+/}).click(); await frame.locator('[data-file="second.js"]').waitFor(); await body.evaluate(() => document.activeElement?.blur());
  await body.press('p'); assert.deepEqual(await target(), {type:'line',id:'1',lineNumber:50,side:'additions',align:'start'});
  await body.press('n'); assert.deepEqual(await target(), {type:'line',id:'2',lineNumber:1,side:'additions',align:'start'});
  await body.press('p'); assert.deepEqual(await target(), {type:'line',id:'1',lineNumber:50,side:'additions',align:'start'});
  await frame.getByRole('button', {name:/first\.js \+/}).click(); await body.evaluate(() => document.activeElement?.blur()); await body.press('n'); assert.equal((await target()).lineNumber, 1); await body.press('n'); assert.equal((await target()).lineNumber, 50);
  await frame.getByRole('button', {name:/first\.js \+/}).click(); await body.evaluate(() => document.activeElement?.blur()); await body.press('j'); assert.equal((await target()).id,'1'); await body.press('k'); assert.equal((await target()).id,'0');
});

test('worker failure falls back and special files remain visible', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-fallback-')); const dist = path.join(dir, 'dist'); await mkdir(dist); execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const special = patch + 'diff --git a/mode b/mode\nold mode 100644\nnew mode 100755\n' + 'diff --git a/pic b/pic\nindex 1111111..2222222 100644\nBinary files a/pic and b/pic differ\n' + 'diff --git a/unknown.ex b/unknown.ex\nindex 1111111..2222222 100644\n--- a/unknown.ex\n+++ b/unknown.ex\n@@ -1 +1 @@\n-old\n+new\n';
  const { file } = await writeDiffPage({ ...source, patch: special, to: '@-' }, dist, path.join(dir, 'page/index.html')); let browser;
  t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }); const url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage(); await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('workers disabled'); } }; }); await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(url); const frame = page.locator('iframe').first().contentFrame(); await frame.getByRole('heading', { name: 'Files (4)' }).waitFor(); await frame.locator('[data-content] [data-line-type="change-addition"] span[style]').first().waitFor({ timeout: 20000 });
  assert.match(await frame.locator('.sidebar').innerText(), /unknown.ex/); assert.match(await frame.locator('.sidebar').innerText(), /pic/); assert.match(await frame.locator('.sidebar').innerText(), /mode/); assert.ok(await frame.getByText('Working tree may differ from the reviewed revision').count() >= 1);
  await frame.getByRole('button', { name: /mode \+/ }).click(); await frame.getByText('mode 100644 → 100755').waitFor(); await frame.getByRole('button', { name: /pic \+/ }).click(); await frame.getByText('Binary file changed').waitFor(); await frame.getByRole('button', { name: /unknown.ex \+/ }).click(); await frame.locator('[data-content]').getByText('new', { exact: true }).waitFor();
});

test('jj watch updates only when patch changes without reloading iframe', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-watch-')), repo = path.join(dir, 'repo'), out = path.join(dir, 'review/index.html'); await mkdir(repo);
  execFileSync('jj', ['git', 'init', repo]); await writeFile(path.join(repo, 'watch.js'), 'const watched = 1;\n'); await writeFile(path.join(repo, 'stable.js'), 'const stable = 1;\n');
  const child = spawn(process.execPath, [path.resolve(root, '../../bin/lavish-view'), 'diff', '-r', '@', '--watch', '--out', out], { cwd: repo, env: { ...process.env, XDG_DATA_HOME: path.join(dir, 'cache'), HC_TERMINAL_ID: '' } }); let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); let browser;
  t.after(async () => { child.kill(); if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', out], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`watch startup: ${stderr}`)), 90000); child.stdout.on('data', () => { if (/http:\/\/[^\s]+/.test(stdout)) { clearTimeout(timer); resolve(); } }); child.on('exit', code => { clearTimeout(timer); reject(new Error(`watch exited ${code}: ${stderr}`)); }); });
  const url = stdout.match(/http:\/\/[^\s]+/)[0]; browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage(); await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()); await page.goto(url); const frame = page.locator('iframe').first().contentFrame(); await frame.getByRole('heading', { name: 'Files (2)' }).waitFor(); await frame.locator('[data-file="stable.js"]').getByRole('checkbox', { name: 'Viewed' }).check(); await frame.locator('body').evaluate(() => { window.__watchIdentity = Math.random(); }); const identity = await frame.locator('body').evaluate(() => window.__watchIdentity);
  execFileSync('jj', ['describe', '-m', 'description only'], { cwd: repo }); await page.waitForTimeout(6000); assert.equal(await frame.getByRole('button', { name: 'Refresh' }).count(), 0);
  await frame.getByRole('button', { name: /watch\.js \+/ }).click(); await frame.locator('[data-content]').getByText('const watched = 1;', { exact: true }).waitFor();
  await writeFile(path.join(repo, 'watch.js'), 'const watched = 2;\n'); await frame.getByRole('button', { name: 'Refresh' }).waitFor({ timeout: 12000 }); await frame.getByRole('button', { name: 'Refresh' }).click(); await frame.locator('[data-content]').getByText('const watched = 2;', { exact: true }).waitFor(); assert.equal(await frame.locator('[data-content]').getByText('const watched = 1;', { exact: true }).count(), 0); assert.equal(await frame.locator('body').evaluate(() => window.__watchIdentity), identity);
  assert.match(await frame.locator('.sidebar').innerText(), /✓/); assert.equal(stdout.trim().split('\n').length, 1);
  const revision = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], { cwd: repo, encoding: 'utf8' }).trim();
  await frame.locator('[data-gutter] [data-line-type="change-addition"]').last().click(); const draft = frame.getByPlaceholder('Write a comment'); await draft.fill('real revision');
  const poll = spawn('lavish-axi', ['poll', out, '--timeout-ms', '15000']); let pollOutput = ''; poll.stdout.on('data', chunk => pollOutput += chunk); const pollDone = new Promise((resolve, reject) => { poll.on('error', reject); poll.on('close', resolve); }); t.after(() => poll.kill());
  await frame.getByRole('button', { name: 'Queue comment' }).click(); await page.getByRole('button', { name: 'Send to Agent' }).click(); await pollDone; assert.match(pollOutput, /watch\.js:1/); assert.ok(pollOutput.includes(revision)); assert.match(pollOutput, /watched = 2/);
});

test('large diff loads quickly with virtualized rows', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-scale-')); const dist = path.join(dir, 'dist'); await mkdir(dist); execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const lines = Array.from({ length: 120 }, (_, i) => `+const line${i} = '${'x'.repeat(76)}';\n`).join('');
  const large = Array.from({ length: 500 }, (_, i) => `diff --git a/file${i}.js b/file${i}.js\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/file${i}.js\n@@ -0,0 +1,120 @@\n${lines}`).join('');
  assert.ok(Buffer.byteLength(large) >= 5_000_000); const { file } = await writeDiffPage({ ...source, patch: large }, dist, path.join(dir, 'page/index.html'));
  let browser; t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }); const url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage(); await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const start = performance.now(); await page.goto(url); const frame = page.locator('iframe').first().contentFrame(); await frame.locator('[data-content] [data-line]').first().waitFor({ timeout: 15000 }); const elapsed = performance.now() - start;
  const rows = await frame.locator('[data-content] [data-line]').count(); console.log(`Scale: ${Buffer.byteLength(large)} bytes, 500 files, 60000 lines, first row ${elapsed.toFixed(0)}ms, ${rows} rendered rows`); assert.ok(elapsed < 5000, `first row took ${elapsed.toFixed(0)}ms`); assert.ok(rows < 6000, `${rows} rows rendered`);
  await frame.getByRole('button', { name: /file250\.js \+/ }).click(); const anchor = frame.locator('[data-file="file250.js"]'); await anchor.waitFor(); await frame.locator('body').evaluate(() => document.activeElement?.blur()); await frame.locator('body').press('v'); assert.match(await frame.getByRole('button', { name: /file250\.js \+/ }).innerText(), /✓/);
  const extra = 'diff --git a/extra.js b/extra.js\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/extra.js\n@@ -0,0 +1 @@\n+extra\n'; await writeDiffPage({ ...source, patch: extra + large }, dist, file); await frame.getByRole('button', { name: 'Refresh' }).click({ timeout: 10000 }); await anchor.waitFor({ timeout: 10000 }); assert.equal(await anchor.isVisible(), true);
});
