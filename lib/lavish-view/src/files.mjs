import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.lavish-view-${randomUUID()}.tmp`);
  try { await writeFile(temp, content, { flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

export function repoRoot(cwd) {
  for (const [command, args] of [['jj', ['root']], ['git', ['rev-parse', '--show-toplevel']]]) {
    try { return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (error) { if (error.code !== 'ENOENT' && typeof error.status !== 'number') throw error; }
  }
  return null;
}

export async function assertOutsideRepo(out, root) {
  if (!root) return;
  root = await realpath(root);
  let ancestor = path.resolve(out), missing = [];
  while (true) {
    try { await lstat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
  const destination = path.join(await realpath(ancestor), ...missing);
  const relative = path.relative(root, destination);
  if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('TODO(prose): output inside reviewed repository');
  }
}
