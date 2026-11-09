import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from './files.mjs';

const load = async (deps, name) => import(pathToFileURL(deps.resolve(name)).href);

function headingText(token) {
  return (token.children || []).map(child => {
    if (child.type === 'text' || child.type === 'code_inline') return child.content;
    if (child.type === 'image') return headingText(child) || child.content;
    if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
    return '';
  }).join('').trim();
}

export async function renderMarkdown(source, deps) {
  const [{ default: MarkdownIt }, { default: taskLists }, { default: anchor },
    { default: frontMatter }, { default: shiki }, yaml] = await Promise.all([
    load(deps, 'markdown-it'), load(deps, 'markdown-it-task-lists'),
    load(deps, 'markdown-it-anchor'), load(deps, 'markdown-it-front-matter'),
    load(deps, '@shikijs/markdown-it'), load(deps, 'yaml'),
  ]);
  let rawFrontMatter;
  const md = new MarkdownIt({ html: true, linkify: true });
  md.use(taskLists).use(anchor, { permalink: anchor.permalink.linkInsideHeader({ symbol: '#' }) });
  md.use(frontMatter, raw => { rawFrontMatter = raw; });
  md.use(await shiki({ themes: { light: 'github-light', dark: 'github-dark' }, fallbackLanguage: 'text' }));
  const tokens = md.parse(source, {});
  const firstHeading = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1');
  const heading = firstHeading < 0 ? '' : headingText(tokens[firstHeading + 1]);
  let metadata = '', title;
  if (rawFrontMatter !== undefined) {
    try {
      const data = yaml.parse(rawFrontMatter);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim();
        const rows = Object.entries(data).map(([key, value]) => {
          const display = value !== null && typeof value === 'object' ? yaml.stringify(value).trimEnd() : String(value ?? '');
          return `<tr><th scope="row">${md.utils.escapeHtml(key)}</th><td>${md.utils.escapeHtml(display)}</td></tr>`;
        }).join('\n');
        metadata = `<table class="metadata"><tbody>${rows}</tbody></table>`;
      } else if (data !== null && data !== undefined) {
        metadata = `<pre>${md.utils.escapeHtml(rawFrontMatter)}</pre>`;
      }
    } catch {
      metadata = `<pre>${md.utils.escapeHtml(rawFrontMatter)}</pre>`;
    }
  }
  return { body: md.renderer.render(tokens, md.options, {}), metadata, title: title || heading };
}

export function markdownOutputPath(source) {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 10);
  const basename = path.basename(source, path.extname(source));
  return path.join(os.homedir(), '.local/share/polytoken/artifacts/markdown', `${basename}-${hash}`, 'index.html');
}

export async function writeMarkdown(file, deps, { out } = {}) {
  const source = await realpath(file);
  const output = out ? path.resolve(out) : markdownOutputPath(source);
  const { body, metadata, title: extracted } = await renderMarkdown(await readFile(source, 'utf8'), deps);
  const title = extracted || path.basename(source);
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>
<style>
  body { background: var(--color-base-100); color: var(--color-base-content); }
  .document { max-width: 80ch; margin: auto; padding: 2rem; overflow-wrap: anywhere; line-height: 1.65; }
  .document :is(h1,h2,h3,h4,h5,h6) { font-weight: 700; line-height: 1.25; margin: 1.5em 0 .5em; }
  .document h1 { font-size: 2em; } .document h2 { font-size: 1.5em; } .document h3 { font-size: 1.25em; }
  .document :is(p,ul,ol,table,pre,blockquote) { margin: 1em 0; }
  .document :is(ul,ol) { padding-left: 1.5em; } .document ul { list-style: disc; } .document ol { list-style: decimal; }
  .document a { color: var(--color-primary); text-decoration: underline; }
  .document table { border-collapse: collapse; display: block; overflow-x: auto; }
  .document :is(th,td) { border: 1px solid var(--color-base-300); padding: .35em .65em; text-align: left; vertical-align: top; white-space: pre-wrap; }
  .document pre { overflow-x: auto; padding: 1em; border-radius: .5em; }
  .document blockquote { border-left: .25em solid var(--color-base-300); padding-left: 1em; }
  .document img { max-width: 100%; } .document .task-list-item { list-style: none; }
  @media (prefers-color-scheme: dark) { .shiki, .shiki span { color: var(--shiki-dark) !important; background-color: var(--shiki-dark-bg) !important; } }
</style>
</head>
<body><main class="document prose">${metadata}\n${body}</main></body>
</html>\n`;
  await atomicWrite(output, html);
  return { file: output, title };
}
