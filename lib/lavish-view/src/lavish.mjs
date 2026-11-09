import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function openReview(file, { title, open = false, reopen = false } = {}) {
  file = path.resolve(file);
  let result;
  try { result = await exec('lavish-axi', [file, ...(open ? [] : ['--no-open']), ...(reopen ? ['--reopen'] : [])]); }
  catch (error) { throw new Error(error.stderr?.trim() || `TODO(prose): lavish-axi failed: ${error.message}`); }
  if (/^\s*status:\s*user-ended\s*$/m.test(result.stdout)) {
    console.log('TODO(prose): user ended review; --reopen');
    return { ended: true };
  }
  const url = result.stdout.match(/^\s*url:\s*(https?:\/\/\S+)\s*$/m)?.[1];
  if (!url) throw new Error(result.stderr?.trim() || 'TODO(prose): lavish-axi returned no URL');
  if (title === undefined) {
    const html = await readFile(file, 'utf8');
    title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1].trim() || path.basename(file);
  }
  let registered = false;
  if (process.env.HC_TERMINAL_ID) {
    try {
      await exec('herdr-app', ['do', `task-tree.artifact:${JSON.stringify({ terminal: process.env.HC_TERMINAL_ID, path: file, title })}`]);
      registered = true;
    } catch { /* Registration is optional. */ }
  }
  console.log(registered ? 'TODO(prose): Artifacts' : `TODO(prose): ${url} — ask the user to open it`);
  return { url, registered };
}
