import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, chmod, symlink, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../../bin/lavish-view', import.meta.url));
const shared = await mkdtemp(path.join(os.tmpdir(), 'lavish-cli-cache-'));
const setupBin = path.join(shared, 'bin'); await mkdir(setupBin);
const npm = path.join(setupBin, 'npm'); await writeFile(npm, '#!/bin/sh\ncp -R "$FIXTURE" node_modules\n'); await chmod(npm, 0o755);
const depsModule = fileURLToPath(new URL('../src/deps.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../node_modules', import.meta.url));
const init = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(depsModule)}).then(m=>m.ensureDeps())`], { env: { ...process.env, XDG_DATA_HOME: shared, PATH: `${setupBin}:/usr/bin:/bin`, FIXTURE: fixture }, encoding: 'utf8' });
assert.equal(init.status, 0, init.stderr);
test.after(() => rm(shared, { recursive: true, force: true }));
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); await mkdir(bin);
  const fake = async (name, body) => { const p = path.join(bin, name); await writeFile(p, `#!/bin/sh\n${body}\n`); await chmod(p, 0o755); };
  await fake('lavish-axi', 'printf "  url: http://localhost:123/review\\n"');
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, XDG_DATA_HOME: shared, HC_TERMINAL_ID: '', LOG: path.join(dir, 'log') };
  const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
  const file = path.join(dir, 'page.html'); await writeFile(file, '<title>Page title</title>');
  return { dir, bin, fake, run, file, env };
}

test('registers html with title and title override', async t => {
  const x = await setup(t); await x.fake('herdr-app', 'printf "%s\\n" "$@" > "$LOG"');
  for (const [args, title] of [[[x.file], 'Page title'], [[x.file, '--title', 'Override'], 'Override']]) {
    const r = x.run(args, { HC_TERMINAL_ID: 'terminal' }); assert.equal(r.status, 0); assert.match(r.stdout, /^TODO\(prose\): Artifacts\n$/); assert.equal(r.stderr, '');
    const [command, artifact] = (await readFile(x.env.LOG, 'utf8')).trim().split('\n'); assert.equal(command, 'do');
    assert.deepEqual(JSON.parse(artifact.slice('task-tree.artifact:'.length)), { terminal: 'terminal', path: x.file, title });
  }
});
test('fallbacks are silent on stderr', async t => {
  const x = await setup(t);
  for (const [terminal, script] of [['', null], ['t', null], ['t', 'echo need the mod loaded >&2; exit 1']]) {
    if (script) await x.fake('herdr-app', script);
    const r = x.run([x.file], { HC_TERMINAL_ID: terminal }); assert.equal(r.status, 0); assert.match(r.stdout, /^TODO\(prose\): http:\/\/localhost:123\/review.*\n$/); assert.equal(r.stderr, '');
  }
});
test('bad input, lavish failure, and no shell interpolation', async t => {
  const x = await setup(t);
  for (const args of [[], ['missing.html'], [x.file, '--bad'], ['bad.txt'], [x.file, '--title']]) assert.equal(x.run(args).status, 2);
  await x.fake('lavish-axi', 'echo broken >&2; exit 1'); let r = x.run([x.file]); assert.equal(r.status, 1); assert.match(r.stderr, /broken/);
  await x.fake('lavish-axi', 'echo nothing'); r = x.run([x.file]); assert.equal(r.status, 1);
  await x.fake('lavish-axi', 'printf "url: http://localhost:123/review\\n"');
  const hostile = path.join(x.dir, '$(touch pwned); page.html'); await writeFile(hostile, '<title>x</title>');
  assert.equal(x.run([hostile]).status, 0); await assert.rejects(access(path.join(x.dir, 'pwned')));
});
test('user-ended review does not register and --reopen is forwarded', async t => {
  const x = await setup(t); await x.fake('herdr-app', 'touch "$LOG"');
  await x.fake('lavish-axi', 'printf "status: user-ended\\nurl: http://localhost:123/review\\n"');
  let r = x.run([x.file], { HC_TERMINAL_ID: 't' }); assert.equal(r.status, 0); assert.match(r.stdout, /--reopen/); await assert.rejects(access(x.env.LOG));
  await x.fake('lavish-axi', 'printf "%s\\n" "$@" > "$LOG"; printf "url: http://localhost:123/review\\n"');
  r = x.run([x.file, '--reopen', '--open']); assert.equal(r.status, 0); assert.match(await readFile(x.env.LOG, 'utf8'), /--reopen/); assert.doesNotMatch(await readFile(x.env.LOG, 'utf8'), /--no-open/);
});
test('first-use npm failure is reported and leaves no partial cache', async t => {
  const x = await setup(t); await x.fake('npm', 'echo network-broke >&2; exit 1');
  const data = path.join(x.dir, 'data'); const r = x.run([x.file], { XDG_DATA_HOME: data });
  assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /network-broke/); assert.match(r.stderr, /retry: lavish-view/);
  assert.deepEqual(await readdir(path.join(data, 'lavish-view', 'deps')), []);
});
test('executable works through a deployed symlink', async t => {
  const x = await setup(t); const link = path.join(x.bin, 'lavish-view'); await symlink(cli, link);
  const r = spawnSync(link, [x.file], { cwd: x.dir, env: { ...x.env, PATH: `${x.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /http:\/\/localhost:123\/review/);
});
test('output confinement precedes creating files for markdown and diff', async t => {
  const x = await setup(t); const repo = path.join(x.dir, 'repo'); await mkdir(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const md = path.join(repo, 'page.md'); await writeFile(md, '# test');
  const link = path.join(x.dir, 'link'); await symlink(repo, link);
  const sourceLink = path.join(x.dir, 'linked.md'); await symlink(md, sourceLink);
  const linkedResult = x.run([sourceLink, '--out', path.join(repo, 'new', 'index.html')]);
  assert.equal(linkedResult.status, 1); assert.match(linkedResult.stderr, /output inside/); await assert.rejects(access(path.join(repo, 'new')));
  for (const out of [path.join(repo, 'new', 'index.html'), path.join(link, 'new', 'index.html')]) {
    for (const args of [[md, '--out', out], ['diff', '--repo-root', repo, '-', '--out', out]]) {
      const r = x.run(args); assert.equal(r.status, 1); assert.match(r.stderr, /output inside/); await assert.rejects(access(path.join(repo, 'new')));
    }
  }
  const out = path.join(x.dir, 'outside', 'index.html'); let r = x.run([md, '--out', out]);
  assert.equal(r.status, 0, r.stderr); assert.match(await readFile(out, 'utf8'), /<h1 id="test"[^>]*>/);
  r = x.run([x.file, '--out', out]); assert.equal(r.status, 0); assert.equal(await readFile(out, 'utf8'), '<title>Page title</title>');
  r = x.run([md], { HOME: repo }); assert.equal(r.status, 1); assert.match(r.stderr, /output inside/); await assert.rejects(access(path.join(repo, '.local')));
});
test('markdown title is registered and can be overridden', async t => {
  const x = await setup(t); await x.fake('herdr-app', 'printf "%s\\n" "$@" > "$LOG"');
  const file = path.join(x.dir, 'doc.md'); await writeFile(file, '---\ntitle: "A & B"\n---\n# Heading');
  for (const [extra, title] of [[[], 'A & B'], [['--title', 'Override'], 'Override']]) {
    const out = path.join(x.dir, 'out.html');
    const r = x.run([file, '--out', out, ...extra], { HC_TERMINAL_ID: 'terminal' });
    assert.equal(r.status, 0, r.stderr);
    const [, artifact] = (await readFile(x.env.LOG, 'utf8')).trim().split('\n');
    assert.deepEqual(JSON.parse(artifact.slice('task-tree.artifact:'.length)), { terminal: 'terminal', path: out, title });
  }
});
