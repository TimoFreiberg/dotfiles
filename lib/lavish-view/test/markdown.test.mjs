import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderMarkdown, writeMarkdown } from '../src/markdown.mjs';

const require = createRequire(import.meta.url);
const deps = { resolve: name => require.resolve(name) };
const fixture = `---
title: "Metadata & title"
author: "<Ada>"
---
# First heading

| A | B |
| - | - |
| 1 | 2 |

- [x] done
- [ ] pending

\`\`\`js
const x = 1;
\`\`\`

Inline <em>HTML</em> and https://example.com.
`;

test('renders gfm, front matter, shiki, and raw html', async () => {
  const page = await renderMarkdown(fixture, deps);
  assert.equal(page.title, 'Metadata & title');
  assert.match(page.metadata, /<table class="metadata">/);
  assert.match(page.metadata, /<th scope="row">author<\/th><td>&lt;Ada&gt;<\/td>/);
  assert.doesNotMatch(page.body, /Metadata &amp; title|---/);
  assert.match(page.body, /<table>/);
  assert.match(page.body, /<input\b(?=[^>]*type="checkbox")(?=[^>]*checked)[^>]*>/);
  assert.match(page.body, /id="first-heading"/);
  assert.match(page.body, /href="#first-heading"/);
  assert.match(page.body, /class="shiki /);
  assert.match(page.body, /<span style="color:/);
  assert.match(page.body, /<em>HTML<\/em>/);
  assert.match(page.body, /href="https:\/\/example\.com"/);
});

test('invalid yaml is escaped and heading supplies title', async () => {
  const page = await renderMarkdown('---\ntitle: [bad <value>\n---\n# First *heading* & more\n\n```unknown-lang\n<code>\n```', deps);
  assert.match(page.metadata, /<pre>title: \[bad &lt;value&gt;<\/pre>/);
  assert.equal(page.title, 'First heading & more');
  assert.match(page.body, /&#x3C;code>/);
  assert.doesNotMatch(page.body, /<code><code>/);
});

test('stable output path, atomic replacement, and title precedence', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-markdown-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'sample.markdown');
  const alias = path.join(dir, 'alias.md');
  await writeFile(source, fixture); await symlink(source, alias);
  const out = path.join(dir, 'out', 'index.html');
  const first = await writeMarkdown(source, deps, { out });
  const firstStat = await stat(out);
  assert.equal(first.title, 'Metadata & title');
  assert.match(await readFile(out, 'utf8'), /<title>Metadata &amp; title<\/title>/);
  await writeFile(source, '# Second\n\nChanged');
  const second = await writeMarkdown(source, deps, { out });
  const secondStat = await stat(out);
  assert.equal(second.file, first.file);
  assert.notEqual(secondStat.ino, firstStat.ino);
  assert.equal(second.title, 'Second');
  assert.match(await readFile(out, 'utf8'), /Changed/);
  assert.deepEqual(await readdir(path.dirname(out)), ['index.html']);
  const previousHome = process.env.HOME;
  process.env.HOME = dir;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  const defaultFirst = await writeMarkdown(source, deps);
  const defaultStat = await stat(defaultFirst.file);
  await writeFile(source, '# Third\n\nUpdated default');
  const defaultSecond = await writeMarkdown(alias, deps);
  assert.equal(defaultFirst.file, defaultSecond.file);
  assert.notEqual((await stat(defaultSecond.file)).ino, defaultStat.ino);
  assert.match(await readFile(defaultSecond.file, 'utf8'), /Updated default/);
  assert.match(defaultFirst.file, /\/markdown\/sample-[a-f0-9]{10}\/index\.html$/);
  await writeFile(source, 'No heading');
  assert.equal((await writeMarkdown(source, deps, { out })).title, 'sample.markdown');
});
