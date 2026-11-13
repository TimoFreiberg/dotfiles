import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { atomicWrite } from './files.mjs';
import { documentOutputPath, publishDocument } from './document-page.mjs';
import { parsePR } from './pr-format.mjs';
const exec = promisify(execFile);

export async function preparePR(rev = '@-', cwd = process.cwd()) {
  const repo = await realpath((await exec('jj', ['root'], { cwd })).stdout.trim());
  const ids = (await exec('jj', ['log', '-r', rev, '--no-graph', '-T', 'commit_id ++ "\\n"'], { cwd: repo })).stdout.trim().split('\n').filter(Boolean);
  if (ids.length !== 1) throw new Error('PR head revision must resolve to exactly one commit');
  const commits = (await exec('jj', ['log', '-r', `(trunk()..(${rev})) | (${rev})`, '--no-graph', '-T', 'commit_id.short() ++ " " ++ description.first_line() ++ "\\n"'], { cwd: repo })).stdout.trim().split('\n').filter(Boolean);
  return { repo, rev, head: ids[0], commits };
}
export async function writePRPage(source, dist, pr, { out, title } = {}) {
  source = await realpath(source);
  const draft = parsePR(await readFile(source, 'utf8'));
  const file = documentOutputPath(source, out, 'pr');
  title ||= `PR: ${draft.title}`;
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  await mkdir(path.dirname(file), { recursive: true });
  await cp(dist, path.join(path.dirname(file), 'assets'), { recursive: true, force: true });
  await atomicWrite(file, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="./assets/document.css"></head><body><main id="app"></main><script>globalThis.lavishViewPR=${JSON.stringify(pr).replaceAll('<', '\\u003c')};</script><script src="./assets/pr-app.js"></script></body></html>\n`);
  const hash = await publishDocument(file, source);
  return { file, source, title, hash };
}
