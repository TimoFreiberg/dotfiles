import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './files.mjs';

export async function writeIfChanged(file, text) {
  try { if (await readFile(file, 'utf8') === text) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await atomicWrite(file, text);
}
export async function publishPageData(dir, hash, data) {
  await writeIfChanged(path.join(dir, `data-${hash}.js`), `globalThis.lavishViewData(${JSON.stringify(data)});\n`);
  await atomicWrite(path.join(dir, 'latest.js'), `globalThis.lavishViewLatest(${JSON.stringify(hash)});\n`);
  const names = (await readdir(dir)).filter(name => /^data-[a-f0-9]{64}\.js$/.test(name));
  const ordered = await Promise.all(names.map(async name => ({ name, mtime: (await stat(path.join(dir, name))).mtimeMs })));
  ordered.sort((a, b) => b.mtime - a.mtime);
  const keep = new Set([`data-${hash}.js`, ...ordered.filter(x => x.name !== `data-${hash}.js`).slice(0, 1).map(x => x.name)]);
  await Promise.all(names.filter(name => !keep.has(name)).map(name => rm(path.join(dir, name), { force: true })));
}
