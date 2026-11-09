import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../files.mjs';

const hash = input => createHash('sha256').update(input).digest('hex');
const shell = '<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diff review</title><link rel="stylesheet" href="./assets/diff.css"></head><body><main id="app"></main><script src="./assets/diff-app.js"></script></body></html>\n';

export function pagePath(source, out) {
  if (out) return path.resolve(out);
  const base = path.basename(source.root) || 'root';
  const id = hash(`${source.root}\0${source.rangeSpec}`).slice(0, 10);
  return path.join(process.env.HOME || os.homedir(), '.local/share/polytoken/artifacts/diff', `${base}-${id}`, 'index.html');
}
async function writeIfChanged(file, text) {
  try { if (await readFile(file, 'utf8') === text) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await atomicWrite(file, text);
}
export async function writeDiffPage(source, dist, out) {
  const file = pagePath(source, out), dir = path.dirname(file), patchHash = hash(source.patch);
  await mkdir(dir, { recursive: true });
  await cp(dist, path.join(dir, 'assets'), { recursive: true, force: true });
  await writeIfChanged(file, shell);
  const data = { root: source.root, range: source.range, rangeSource: source.rangeSource, revision: source.revision, commits: source.commits, generated: source.generated, patch: source.patch, kind: source.kind, to: source.to || null };
  await writeIfChanged(path.join(dir, `data-${patchHash}.js`), `globalThis.lavishViewData(${JSON.stringify(data)});\n`);
  await atomicWrite(path.join(dir, 'latest.js'), `globalThis.lavishViewLatest(${JSON.stringify(patchHash)});\n`);
  const names = (await readdir(dir)).filter(name => /^data-[a-f0-9]{64}\.js$/.test(name));
  const { stat } = await import('node:fs/promises');
  const ordered = await Promise.all(names.map(async name => ({ name, mtime: (await stat(path.join(dir, name))).mtimeMs })));
  ordered.sort((a,b) => b.mtime - a.mtime);
  const keep = new Set([`data-${patchHash}.js`, ...ordered.filter(x => x.name !== `data-${patchHash}.js`).slice(0,1).map(x => x.name)]);
  await Promise.all(names.filter(name => !keep.has(name)).map(name => rm(path.join(dir, name), { force: true })));
  return { file, patchHash };
}
