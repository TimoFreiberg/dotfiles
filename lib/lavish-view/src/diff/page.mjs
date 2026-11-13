import { createHash } from 'node:crypto';
import { cp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishPageData, writeIfChanged } from '../page-data.mjs';

const hash = input => createHash('sha256').update(input).digest('hex');
const shell = '<!doctype html>\n<html data-lavish-annotate="off"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diff review</title><link rel="stylesheet" href="./assets/diff.css"></head><body><main id="app"></main><script src="./assets/diff-app.js"></script></body></html>\n';

export function pagePath(source, out) {
  if (out) return path.resolve(out);
  const base = path.basename(source.root) || 'root';
  const id = hash(`${source.root}\0${source.rangeSpec}`).slice(0, 10);
  return path.join(process.env.HOME || os.homedir(), '.local/share/polytoken/artifacts/diff', `${base}-${id}`, 'index.html');
}
export async function writeDiffPage(source, dist, out) {
  const file = pagePath(source, out), dir = path.dirname(file), patchHash = hash(source.patch);
  await mkdir(dir, { recursive: true });
  await cp(dist, path.join(dir, 'assets'), { recursive: true, force: true });
  await writeIfChanged(file, shell);
  const data = { root: source.root, range: source.range, rangeSource: source.rangeSource, revision: source.revision, commits: source.commits, generated: source.generated, patch: source.patch, kind: source.kind, to: source.to || null };
  await publishPageData(dir, patchHash, data);
  return { file, patchHash };
}
