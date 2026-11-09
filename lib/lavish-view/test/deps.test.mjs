import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, chmod, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const depsModule = fileURLToPath(new URL('../src/deps.mjs', import.meta.url));
async function setup(t, failing = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-deps-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'project'), bin = path.join(dir, 'bin'), cache = path.join(dir, 'cache'); await mkdir(project); await mkdir(bin);
  for (const p of ['package.json', 'package-lock.json', 'build.mjs', 'web', 'src/diff']) await cp(path.join(root, p), path.join(project, p), { recursive: true });
  const npm = path.join(bin, 'npm');
  await writeFile(npm, `#!/bin/sh\necho npm >> "$LOG"\n${failing ? 'echo network-broke >&2; exit 1' : 'cp -R "$FIXTURE" node_modules'}\n`); await chmod(npm, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOG: path.join(dir, 'npm.log'), FIXTURE: path.join(root, 'node_modules') };
  const code = `import(${JSON.stringify(depsModule)}).then(m=>m.ensureDeps({root:${JSON.stringify(project)},cache:${JSON.stringify(cache)}})).then(x=>console.log(JSON.stringify({deps:x.deps,dist:x.dist}))).catch(e=>{console.error(e.message);process.exitCode=1})`;
  const run = () => spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
  const asyncRun = () => new Promise(resolve => { const p = spawn(process.execPath, ['-e', code], { env }); let stdout = '', stderr = ''; p.stdout.on('data', x => stdout += x); p.stderr.on('data', x => stderr += x); p.on('close', status => resolve({ status, stdout, stderr })); });
  return { dir, project, cache, env, run, asyncRun };
}
test('builds once and source changes rebuild dist only', async t => {
  const x = await setup(t); let r = x.run(); assert.equal(r.status, 0, r.stderr); const first = JSON.parse(r.stdout);
  assert.equal(await readFile(path.join(first.deps, 'ready'), 'utf8'), ''); assert.equal(await readFile(path.join(first.dist, 'ready'), 'utf8'), '');
  assert.match(await readFile(path.join(first.dist, 'diff-app.js'), 'utf8'), /lavishViewWorkerSource/);
  r = x.run(); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.equal(JSON.parse(r.stdout).dist, first.dist);
  await writeFile(path.join(x.project, 'web/diff.css'), 'body { color: red }'); r = x.run(); assert.equal(r.status, 0, r.stderr);
  const second = JSON.parse(r.stdout); assert.equal(second.deps, first.deps); assert.notEqual(second.dist, first.dist); assert.equal(await readFile(path.join(second.dist, 'diff.css'), 'utf8'), 'body { color: red }');
  assert.equal(await readFile(x.env.LOG, 'utf8'), 'npm\n');
});
test('concurrent first runs share cache', async t => {
  const x = await setup(t); const [a, b] = await Promise.all([x.asyncRun(), x.asyncRun()]);
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr); assert.deepEqual(JSON.parse(a.stdout), JSON.parse(b.stdout)); assert.equal(await readFile(x.env.LOG, 'utf8'), 'npm\n');
});
test('recovers a dead lock and removes its abandoned temporary directory', async t => {
  const x = await setup(t);
  const hash = createHash('sha256').update(await readFile(path.join(x.project, 'package-lock.json'))).digest('hex').slice(0, 12);
  const parent = path.join(x.cache, 'deps'), lock = path.join(parent, `${hash}.lock`), temp = path.join(parent, `.${hash}-tmp-abandoned`);
  await mkdir(lock, { recursive: true }); await writeFile(path.join(lock, 'pid'), '99999999'); await mkdir(temp);
  const [a, b] = await Promise.all([x.asyncRun(), x.asyncRun()]);
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr); assert.deepEqual(JSON.parse(a.stdout), JSON.parse(b.stdout));
  assert.deepEqual((await readdir(parent)).sort(), [hash]); assert.equal(await readFile(x.env.LOG, 'utf8'), 'npm\n');
});
test('npm failure leaves no partial level', async t => {
  const x = await setup(t, true); const r = x.run(); assert.equal(r.status, 1); assert.match(r.stderr, /network-broke/); assert.match(r.stderr, /npm ci/); assert.deepEqual(await readdir(path.join(x.cache, 'deps')), []);
});
