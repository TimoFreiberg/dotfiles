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
  await frame.getByRole('button', { name: 'Collapse example.js' }).click(); await frame.getByRole('button', { name: 'Expand example.js' }).waitFor({ timeout: 5000 }); assert.equal(await frame.locator('[data-content] [data-line]').count(), 0); await frame.getByRole('button', { name: 'Expand example.js' }).click(); await frame.locator('[data-content] [data-line]').first().waitFor();
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

test('line comments work in annotation mode and stay beside their lines', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-comments-')), dist = path.join(dir, 'dist'); await mkdir(dist);
  execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  const additions = Array.from({ length: 120 }, (_, i) => `+const extra${i} = ${i};\n`).join('');
  const commentPatch = 'diff --git a/old name.js b/example.js\nrename from old name.js\nrename to example.js\nindex 1111111..2222222 100644\n--- a/old name.js\n+++ b/example.js\n@@ -1,5 +1,126 @@\n context before\n-const oldOne = 1;\n-const oldTwo = 2;\n-const oldThree = 3;\n+const newOne = 1;\n+const newTwo = 2;\n+const newThree = 3;\n+\n' + additions + ' context after\n';
  const { file } = await writeDiffPage({ ...source, patch: commentPatch }, dist, path.join(dir, 'page/index.html')); let browser;
  t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }), url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url, output);
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage({ viewport: { width: 1600, height: 850 } }), errors = [];
  page.on('pageerror', e => errors.push(e.stack));
  await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(url); const frame = page.locator('iframe').first().contentFrame(), body = frame.locator('body');
  await frame.locator('[data-content] [data-line]').first().waitFor({ timeout: 20000 });
  const annotation = page.locator('#annotation'); if (await annotation.getAttribute('aria-pressed') !== 'true') await annotation.click();
  assert.equal(await annotation.getAttribute('aria-pressed'), 'true');
  assert.equal(await frame.locator('.viewport').getAttribute('data-lavish-action'), '');
  await body.evaluate(() => { window.__queuedComments = []; const queue = window.lavish.queuePrompt.bind(window.lavish); window.lavish.queuePrompt = (...args) => { window.__queuedComments.push(args); return queue(...args); }; });
  const row = (side, number) => frame.locator(`[data-content] [data-line="${number}"]${side === 'deletions' ? '[data-line-type="change-deletion"]' : '[data-line-type="change-addition"]'}`);
  const gutter = (side, number) => frame.locator(`[data-gutter] [data-column-number="${number}"][data-line-type="change-${side === 'deletions' ? 'deletion' : 'addition'}"]`);
  const draft = frame.getByPlaceholder('Write a comment'), card = frame.locator('.draft'), cancel = () => frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  const geometry = () => card.evaluate(box => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = box.getBoundingClientRect(), vp = document.querySelector('.viewport').getBoundingClientRect();
    resolve({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, vpTop: vp.top, vpBottom: vp.bottom });
  }))));
  const assertClamped = async () => { const r = await geometry(); assert.ok(r.left >= 7 && r.right <= r.width - 7, JSON.stringify(r)); assert.ok(r.top >= r.vpTop && r.bottom <= Math.min(r.height, r.vpBottom) + 1, JSON.stringify(r)); return r; };
  const queue = async text => { await draft.fill(text); await frame.getByRole('button', { name: 'Queue comment' }).click(); };
  const drag = async (from, to, startX = 8, endX = 8) => {
    await from.waitFor(); await to.waitFor();
    // Measure in the iframe in one JS turn; worker highlighting can replace a
    // row between Playwright resolving it and asking Chromium for its bounds.
    const measure = node => node.getBoundingClientRect().toJSON();
    const a = await from.evaluate(measure), b = await to.evaluate(measure), iframe = await page.locator('iframe').first().boundingBox();
    assert.ok(a.height && b.height && iframe, `${from} to ${to}`);
    await page.mouse.move(iframe.x + a.x + startX, iframe.y + a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(iframe.x + b.x + endX, iframe.y + b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  };

  // Click the far end of the content row, outside its text and gutter.
  const old = row('deletions', 2), oldRect = await old.evaluate(node => ({ top: node.getBoundingClientRect().top, width: node.getBoundingClientRect().width }));
  await old.click({ position: { x: oldRect.width - 20, y: 10 } }); await draft.waitFor();
  assert.equal(await card.locator('strong').innerText(), 'old old name.js:2 (abc123)');
  const initial = await assertClamped(); assert.ok(Math.abs(initial.top - oldRect.top) <= 2, `${initial.top} vs line ${oldRect.top}`);
  assert.ok(initial.bottom < initial.height - 50, 'comment still sits at the bottom of the frame');
  await queue('content click');
  await page.locator('.bubble.queued').first().waitFor();

  // A real double-click selects a word but must not leave the empty draft
  // created by its first click. Do not consume the browser's selection event.
  await row('additions', 2).dblclick({ position: { x: 18, y: 10 } });
  assert.equal(await body.evaluate(() => window.getSelection().toString()), 'const');
  assert.equal(await card.count(), 0);
  assert.equal(await body.evaluate(() => document.activeElement?.matches('textarea')), false);
  await body.evaluate(() => window.getSelection().removeAllRanges());

  // The cleanup must never discard text, even on the same line that opened it.
  await old.click({ position: { x: 18, y: 10 } }); await draft.waitFor();
  await draft.fill('preserve double-click draft'); await draft.evaluate(node => { window.__typedDraftNode = node; });
  await old.dblclick({ position: { x: 18, y: 10 } });
  assert.equal(await body.evaluate(() => window.getSelection().toString()), 'const');
  assert.equal(await draft.inputValue(), 'preserve double-click draft');
  assert.equal(await draft.evaluate(node => node === window.__typedDraftNode), true);
  assert.equal(await card.locator('strong').innerText(), 'old old name.js:2 (abc123)'); await cancel();
  await body.evaluate(() => window.getSelection().removeAllRanges());

  // Selection remains ordinary selectable text: dragging within or across rows
  // must not open a comment or focus a textarea.
  await drag(row('additions', 2), row('additions', 3), 16, 130);
  assert.equal(await card.count(), 0); assert.ok(await body.evaluate(() => window.getSelection().toString().length > 0));
  await body.evaluate(() => window.getSelection().removeAllRanges());

  // A gutter drag queues the range rather than the click after pointerup.
  await drag(gutter('deletions', 2), gutter('deletions', 4)); await draft.waitFor();
  assert.equal(await card.locator('strong').innerText(), 'old old name.js:2-4 (abc123)');
  await queue('old range');
  await frame.getByRole('button', { name: 'Split', exact: true }).click();
  await frame.locator('pre[data-diff-type="split"] [data-additions] [data-content]').waitFor();
  await row('additions', 4).waitFor();
  await drag(gutter('additions', 4), gutter('additions', 2)); await draft.waitFor();
  assert.equal(await card.locator('strong').innerText(), 'new example.js:2-4 (abc123)');
  await queue('new reverse range');

  // Both split context columns have their own line numbers and paths.
  for (const [side, label] of [['deletions', 'old old name.js'], ['additions', 'new example.js']]) {
    const context = frame.locator(`[data-code][data-${side}] [data-content] [data-line="1"]`);
    await context.click({ position: { x: 20, y: 10 } }); await draft.waitFor();
    assert.equal(await card.locator('strong').innerText(), `${label}:1 (abc123)`); await cancel();
  }

  // Empty lines are clickable across their full width too.
  const blank = row('additions', 5), blankWidth = await blank.evaluate(node => node.getBoundingClientRect().width);
  await blank.click({ position: { x: blankWidth - 20, y: 10 } }); await draft.waitFor();
  assert.equal(await card.locator('strong').innerText(), 'new example.js:5 (abc123)');
  await draft.fill('keep this draft');
  await row('deletions', 3).click({ position: { x: 20, y: 10 } });
  assert.equal(await draft.inputValue(), 'keep this draft'); assert.equal(await card.locator('strong').innerText(), 'new example.js:5 (abc123)');
  await frame.getByRole('button', { name: 'Unified', exact: true }).click();
  assert.equal(await draft.inputValue(), 'keep this draft'); await assertClamped();

  // Scroll far enough to remove the anchor from the virtualized DOM, then
  // return. The same textarea survives, and its card follows the restored line.
  await draft.evaluate(node => { window.__draftNode = node; });
  await body.evaluate(() => window.__INSTANCE.scrollTo({ type: 'position', position: 2000 }));
  await blank.waitFor({ state: 'detached' }); await assertClamped();
  assert.equal(await card.evaluate(node => node.classList.contains('anchor-offscreen')), true);
  assert.equal(await draft.inputValue(), 'keep this draft');
  await body.evaluate(() => window.__INSTANCE.scrollTo({ type: 'position', position: 0 }));
  await blank.waitFor(); const restored = await assertClamped(), restoredTop = await blank.evaluate(node => node.getBoundingClientRect().top);
  assert.ok(Math.abs(restored.top - restoredTop) <= 2, `${restored.top} vs restored line ${restoredTop}`);
  assert.equal(await draft.evaluate(node => node === window.__draftNode), true);
  await page.setViewportSize({ width: 760, height: 520 }); await assertClamped();
  assert.equal(await draft.inputValue(), 'keep this draft');
  await queue('empty line');

  // Near the lower/right edge, the draft flips/clamps inside the iframe.
  await page.setViewportSize({ width: 1600, height: 850 });
  await body.evaluate(() => window.__INSTANCE.scrollTo({ type: 'line', id: '0', lineNumber: 120, side: 'additions', align: 'end' }));
  const edge = row('additions', 120); await edge.waitFor(); const edgeWidth = await edge.evaluate(node => node.getBoundingClientRect().width);
  await edge.click({ position: { x: edgeWidth - 20, y: 10 } }); await draft.waitFor();
  const edgeDraft = await assertClamped(), edgeTop = await edge.evaluate(node => node.getBoundingClientRect().top);
  assert.ok(edgeDraft.top < edgeTop - 20, 'draft should move up to fit above the bottom edge'); await cancel();
  const queued = await body.evaluate(() => window.__queuedComments);
  assert.equal(queued.length, 4);
  assert.match(queued[0][0], /old old name\.js:2 \(abc123\)\n\n2: const oldOne = 1;\n\ncontent click/);
  assert.match(queued[1][0], /old old name\.js:2-4 \(abc123\)/); assert.match(queued[1][0], /4: const oldThree = 3;/);
  assert.match(queued[2][0], /new example\.js:2-4 \(abc123\)/); assert.match(queued[2][0], /2: const newOne = 1;/); assert.match(queued[2][0], /4: const newThree = 3;/);
  assert.match(queued[3][0], /new example\.js:5 \(abc123\)\n\n5: \n\nempty line/);
  for (const [, context] of queued) assert.equal(context.tag, 'code-comment');
  assert.equal(await page.locator('.bubble.queued').count(), 4);
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

test('sidebar lands on the clicked file and scrolling renders the whole diff', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-scroll-')); const dist = path.join(dir, 'dist'); await mkdir(dist); execFileSync(process.execPath, [path.join(root, 'build.mjs'), root, dist]);
  // Files with one to five hunks, so per-file header height mistakes would accumulate.
  const hunk = start => `@@ -${start},3 +${start},40 @@\n ctx\n${Array.from({ length: 38 }, (_, i) => `+line${start + i}\n`).join('')}-gone\n ctx\n`;
  const names = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'], patch = names.map((name, i) => `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n${Array.from({ length: i % 5 + 1 }, (_, h) => hunk(1 + h * 100)).join('')}`).join('');
  const commits = Array.from({ length: 6 }, (_, i) => `c${i} commit ${i}`);
  const { file } = await writeDiffPage({ ...source, patch, commits }, dist, path.join(dir, 'page/index.html')); let browser;
  t.after(async () => { if (browser) await browser.close(); try { execFileSync('lavish-axi', ['end', file], { stdio: 'ignore' }); } catch {} await rm(dir, { recursive: true, force: true }); });
  const output = execFileSync('lavish-axi', [file, '--no-open'], { encoding: 'utf8' }); const url = output.match(/url:\s*"?([^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage({ viewport: { width: 1200, height: 700 } }); await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(url); const frame = page.locator('iframe').first().contentFrame(); await frame.locator('[data-content] [data-line]').first().waitFor({ timeout: 20000 });
  const fileTop = name => frame.locator('body').evaluate((_, n) => { const vp = document.querySelector('.viewport').getBoundingClientRect(); const h = [...document.querySelectorAll('[data-file]')].find(x => x.dataset.file === n); return h ? Math.round(h.closest('diffs-container').getBoundingClientRect().top - vp.top) : [...document.querySelectorAll('[data-file]')].map(x => x.dataset.file).join(','); }, name);
  for (const i of [5, 2, 4, 0, 3, 1]) {
    await frame.getByRole('button', { name: new RegExp(`^${names[i].replace('.', '\\.')}`) }).click(); await page.waitForTimeout(500);
    const top = await fileTop(names[i]); assert.ok(typeof top === 'number' && Math.abs(top) <= 2, `${names[i]} landed ${top}px from the top`);
    assert.equal(await frame.locator('.file-link[aria-current]').getAttribute('data-path'), names[i]);
  }
  // The viewport, not the document, scrolls, and code is painted all the way down.
  await frame.locator('.viewport').hover(); let last = -1;
  for (let step = 0; step < 200; step++) {
    await page.mouse.wheel(0, 400); await page.waitForTimeout(30);
    const s = await frame.locator('body').evaluate(() => { const vp = document.querySelector('.viewport'), r = vp.getBoundingClientRect(), y = r.top + r.height / 2; const rows = [...document.querySelectorAll('diffs-container')].flatMap(c => [...c.shadowRoot.querySelectorAll('[data-line],[data-separator]')]); return { top: vp.scrollTop, max: vp.scrollHeight - vp.clientHeight, doc: document.scrollingElement.scrollTop, painted: rows.some(n => { const b = n.getBoundingClientRect(); return b.top <= y + 30 && b.bottom >= y - 30; }) }; });
    assert.equal(s.doc, 0); assert.ok(s.painted, `nothing painted mid-viewport at scrollTop ${s.top}`);
    if (s.top >= s.max - 1) break; assert.ok(s.top > last, `scroll stuck at ${s.top}`); last = s.top;
  }
  assert.ok(last > 0);
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
