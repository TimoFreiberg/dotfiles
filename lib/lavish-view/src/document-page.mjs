import { cp, mkdir, readFile, realpath, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicWrite } from './files.mjs';
import { textHash } from './save.mjs';

export function documentOutputPath(source, out, kind = 'task') {
  return out ? path.resolve(out) : path.join(process.env.HOME || os.homedir(), '.local/share/polytoken/artifacts', kind, `${path.basename(source, path.extname(source))}-${textHash(source).slice(0, 10)}`, 'index.html');
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export async function publishDocument(file, source) {
  const bytes = await readFile(source), hash = textHash(bytes), dir = path.dirname(file);
  const data = { sourceFile: source, text: bytes.toString('utf8'), hash };
  await atomicWrite(path.join(dir, `data-${hash}.js`), `globalThis.lavishViewData(${JSON.stringify(data)});\n`);
  await atomicWrite(path.join(dir, 'latest.js'), `globalThis.lavishViewLatest(${JSON.stringify(hash)});\n`);
  const names = (await readdir(dir)).filter(name => /^data-[a-f0-9]{64}\.js$/.test(name));
  const ordered = await Promise.all(names.map(async name => ({ name, mtime: (await stat(path.join(dir, name))).mtimeMs })));
  ordered.sort((a, b) => b.mtime - a.mtime);
  const keep = new Set([`data-${hash}.js`, ...ordered.filter(x => x.name !== `data-${hash}.js`).slice(0, 1).map(x => x.name)]);
  await Promise.all(names.filter(name => !keep.has(name)).map(name => rm(path.join(dir, name), { force: true })));
  return hash;
}
export async function writeTaskPage(source, dist, { out, title } = {}) {
  source = await realpath(source);
  const file = documentOutputPath(source, out);
  title ||= path.basename(source);
  await mkdir(path.dirname(file), { recursive: true });
  await cp(dist, path.join(path.dirname(file), 'assets'), { recursive: true, force: true });
  await atomicWrite(file, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="./assets/document.css"></head><body><main id="app"></main><script src="./assets/task-app.js"></script></body></html>\n`);
  const hash = await publishDocument(file, source);
  return { file, source, title, hash };
}
export async function watchDocument(file, source, initialHash, { interval = 1000, signal, log = console.error } = {}) {
  let hash = initialHash;
  while (!signal?.aborted) {
    await new Promise(resolve => setTimeout(resolve, interval));
    if (signal?.aborted) break;
    try {
      if (textHash(await readFile(source)) !== hash) hash = await publishDocument(file, source);
    } catch (error) { log(`lavish-view document: ${error.message} (still watching; last disk version remains on the page)`); }
  }
}
