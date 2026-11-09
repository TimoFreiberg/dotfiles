import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async p => access(p).then(() => true, () => false);

async function inputs(dir, prefix = '') {
  const result = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await inputs(path.join(dir, entry.name), name));
    else if (entry.isFile()) result.push([name, await readFile(path.join(dir, entry.name))]);
  }
  return result;
}
function digest(parts) {
  const hash = createHash('sha256');
  for (const [name, bytes] of parts) hash.update(`${name.length}:${name}:${bytes.length}:`).update(bytes);
  return hash.digest('hex').slice(0, 12);
}
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command}: ${stderr.trim() || `exit ${code}`}`)));
  });
}
async function reclaimLock(lock) {
  const claim = path.join(lock, 'reclaim');
  let modified;
  try { modified = (await stat(lock)).mtimeMs; await mkdir(claim); } catch (error) { if (error.code === 'EEXIST' || error.code === 'ENOENT') return; throw error; }
  let stale = false;
  try {
    try {
      const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'));
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') stale = true; }
      } else stale = Date.now() - modified > 5000;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      stale = Date.now() - modified > 5000;
    }
    if (stale) await rm(lock, { recursive: true, force: true });
  } finally { if (!stale) await rm(claim, { recursive: true, force: true }); }
}
async function buildLevel(target, action) {
  if (await exists(path.join(target, 'ready'))) return;
  const parent = path.dirname(target), lock = `${target}.lock`, deadline = Date.now() + 120000;
  await mkdir(parent, { recursive: true });
  while (true) {
    try {
      await mkdir(lock);
      try { await writeFile(path.join(lock, 'pid'), String(process.pid)); }
      catch (error) { await rm(lock, { recursive: true, force: true }); throw error; }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await exists(path.join(target, 'ready'))) return;
      try {
        const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') await reclaimLock(lock); }
        } else if (Date.now() - (await stat(lock)).mtimeMs > 5000) await reclaimLock(lock);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 5000) await reclaimLock(lock); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      }
      if (Date.now() >= deadline) throw new Error(`another lavish-view run has been building ${target} for over 120 s; rerun the same command once it finishes`);
      await pause(100);
    }
  }
  let temp;
  try {
    if (await exists(path.join(target, 'ready'))) return;
    await rm(target, { recursive: true, force: true });
    const prefix = `.${path.basename(target)}-tmp-`;
    for (const name of await readdir(parent)) if (name.startsWith(prefix)) await rm(path.join(parent, name), { recursive: true, force: true });
    temp = await mkdtemp(path.join(parent, prefix));
    process.stderr.write(`lavish-view: building ${target} (first run after an install or update)\n`);
    await action(temp);
    await writeFile(path.join(temp, 'ready'), '');
    await rename(temp, target);
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function ensureDeps({ root = defaultRoot, cache = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'lavish-view') } = {}) {
  const lock = await readFile(path.join(root, 'package-lock.json'));
  const depsHash = createHash('sha256').update(lock).digest('hex').slice(0, 12);
  const buildFiles = [['package-lock.json', lock], ['build.mjs', await readFile(path.join(root, 'build.mjs'))],
    ['src/diff/model.mjs', await readFile(path.join(root, 'src/diff/model.mjs'))],
    ...(await inputs(path.join(root, 'web'))).map(([name, bytes]) => [`web/${name}`, bytes])];
  const deps = path.join(cache, 'deps', depsHash);
  const dist = path.join(cache, 'dist', digest(buildFiles));
  await buildLevel(deps, async temp => {
    await copyFile(path.join(root, 'package.json'), path.join(temp, 'package.json'));
    await copyFile(path.join(root, 'package-lock.json'), path.join(temp, 'package-lock.json'));
    try { await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], temp); }
    catch (error) { throw new Error(`installing dependencies with npm ci failed: ${error.message.replace(/\s+/g, ' ')}. The first run needs npm and network access; fix that and rerun the same lavish-view command`); }
  });
  await buildLevel(dist, async temp => {
    try { await run(process.execPath, [path.join(root, 'build.mjs'), deps, temp], root); }
    catch (error) { throw new Error(`building the diff page bundle failed: ${error.message.replace(/\s+/g, ' ')}. Fix the cause and rerun the same lavish-view command`); }
  });
  const require = createRequire(path.join(deps, 'package.json'));
  return { deps, dist, require, resolve: name => require.resolve(name) };
}
