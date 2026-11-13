import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { documentOutputPath, publishDocument, writeDocumentShell } from './document-page.mjs';
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
  await writeDocumentShell(file, dist, title, 'pr', pr);
  const hash = await publishDocument(file, source);
  return { file, source, title, hash };
}
