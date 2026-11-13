import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, chmod, symlink, access, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
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
  const fake = async (name, body) => { const p = path.join(bin, name); const prefix = name === 'lavish-axi' ? 'if [ "$1" = poll ]; then printf "session:\\n  status: ended\\n"; exit; fi\n' : ''; await writeFile(p, `#!/bin/sh\n${prefix}${body}\n`); await chmod(p, 0o755); };
  await fake('hc', 'if [ "$1" = get ]; then printf \'{"address":"%s","state":"live","labels":{}}\\n\' "$2"; else printf \'[]\\n\'; fi');
  await fake('lavish-axi', 'printf "  url: http://localhost:123/review\\n"');
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, XDG_DATA_HOME: shared, XDG_STATE_HOME: path.join(dir, 'state'), HC_TERMINAL_ID: '', LOG: path.join(dir, 'log') };
  const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
  const file = path.join(dir, 'page.html'); await writeFile(file, '<title>Page title</title>');
  const fakeJS = async (name, body) => { const p = path.join(bin, name); await writeFile(p, `#!${process.execPath}\n${body}\n`); await chmod(p, 0o755); };
  return { dir, bin, fake, fakeJS, run, file, env };
}

const acknowledge = `const fs = require('node:fs');
const payload = JSON.parse(process.argv[3].slice('task-tree.artifact:'.length));
fs.writeFileSync(payload.ack, JSON.stringify({ok:true}));`;
async function assertRegistration(log, expected) {
  const [command, artifact] = (await readFile(log, 'utf8')).trim().split('\n'); assert.equal(command, 'do');
  const { ack, ...payload } = JSON.parse(artifact.slice('task-tree.artifact:'.length));
  assert.deepEqual(payload, expected);
  assert.equal(path.dirname(path.dirname(ack)), os.tmpdir());
  assert.match(path.basename(path.dirname(ack)), /^lavish-artifact-[A-Za-z0-9]{6}$/);
  assert.equal(path.basename(ack), 'ack.json');
  await assert.rejects(access(path.dirname(ack)), 'the acknowledgement directory is removed');
  return ack;
}
test('registers html with title and title override', async t => {
  const x = await setup(t); await x.fakeJS('herdr-app', `${acknowledge}\nfs.writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n'));`);
  for (const [args, title] of [[[x.file], 'Page title'], [[x.file, '--title', 'Override'], 'Override']]) {
    const r = x.run(args, { HC_TERMINAL_ID: 'terminal' }); assert.equal(r.status, 0); assert.equal(r.stdout, `Lavish review of ${x.file} is listed under the task's Artifacts.\n`); assert.equal(r.stderr, '');
    await assertRegistration(x.env.LOG, { terminal: 'terminal', path: x.file, title });
  }
});
test('fallbacks are silent on stderr', async t => {
  const x = await setup(t);
  for (const [terminal, script] of [['', null], ['t', null], ['t', 'echo need the mod loaded >&2; exit 1']]) {
    if (script) await x.fake('herdr-app', script);
    const r = x.run([x.file], { HC_TERMINAL_ID: terminal }); assert.equal(r.status, 0); assert.match(r.stdout, /^Lavish review of .+page\.html ready: http:\/\/localhost:123\/review\S* — ask the user to open it\.\n$/); assert.equal(r.stderr, '');
    if (terminal) assert.equal(JSON.parse(await readFile(`${x.file}.relay.json`)).terminal, terminal, 'target is recorded even without registration');
    else await assert.rejects(access(`${x.file}.relay.json`), 'outside herdr there is no relay sidecar');
  }
});
test('bad input, lavish failure, and no shell interpolation', async t => {
  const x = await setup(t);
  for (const [args, message] of [[[], /^usage:/], [['missing.html'], /missing\.html: no such file/], [[x.file, '--bad'], /unknown argument --bad/], [['bad.txt'], /expected a \.html, \.md, or \.markdown file/], [[x.file, '--title'], /--title requires a value/]]) {
    const r = x.run(args); assert.equal(r.status, 2); assert.match(r.stderr, message); assert.match(r.stderr, /lavish-view --help/);
  }
  await x.fake('lavish-axi', 'echo broken >&2; exit 1'); let r = x.run([x.file]); assert.equal(r.status, 1); assert.match(r.stderr, /broken/);
  await x.fake('lavish-axi', 'echo nothing'); r = x.run([x.file]); assert.equal(r.status, 1);
  await x.fake('lavish-axi', 'printf "url: http://localhost:123/review\\n"');
  const hostile = path.join(x.dir, '$(touch pwned); page.html'); await writeFile(hostile, '<title>x</title>');
  assert.equal(x.run([hostile]).status, 0); await assert.rejects(access(path.join(x.dir, 'pwned')));
  await x.fakeJS('herdr-app', `${acknowledge}\nfs.writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n'));`);
  const title = '$(touch title-pwned); "quoted"';
  r = x.run([hostile, '--title', title], { HC_TERMINAL_ID:'terminal' }); assert.equal(r.status, 0, r.stderr);
  await assertRegistration(x.env.LOG, {terminal:'terminal',path:hostile,title});
  await assert.rejects(access(path.join(x.dir, 'pwned'))); await assert.rejects(access(path.join(x.dir, 'title-pwned')));
});
test('user-ended review does not register or open, and --reopen is forwarded', async t => {
  const x = await setup(t); await x.fake('herdr-app', 'touch "$LOG"');
  await x.fake(process.platform === 'darwin' ? 'open' : 'xdg-open', 'touch "$LOG"');
  await x.fake('lavish-axi', 'printf "status: user-ended\\nurl: http://localhost:123/review\\n"');
  let r = x.run([x.file, '--open'], { HC_TERMINAL_ID: 't' }); assert.equal(r.status, 0); assert.match(r.stdout, /--reopen/); await assert.rejects(access(x.env.LOG));
  await x.fake('lavish-axi', 'printf "%s\\n" "$@" > "$LOG"; printf "url: http://localhost:123/review\\n"');
  r = x.run([x.file, '--reopen']); assert.equal(r.status, 0); const args = await readFile(x.env.LOG, 'utf8'); assert.match(args, /--reopen/); assert.match(args, /--no-open/);
});
test('prepares once and opens the browser only when requested and registration fails', async t => {
  for (const [terminal, succeeds, open, reopen] of [['t', true, true, true], ['t', true, false, false], ['t', false, true, true], ['', false, true, false], ['t', false, false, false], ['', false, false, false]]) {
    const x = await setup(t);
    await x.fake('lavish-axi', 'printf "lavish" >> "$LOG"; printf " <%s>" "$@" >> "$LOG"; printf "\\n" >> "$LOG"; printf "url: http://localhost:123/review\\n"');
    await x.fakeJS('herdr-app', succeeds ? `${acknowledge}\nfs.appendFileSync(process.env.LOG, 'register\\n');` : `require('node:fs').appendFileSync(process.env.LOG, 'register\\n'); process.exit(1);`);
    await x.fake(process.platform === 'darwin' ? 'open' : 'xdg-open', 'printf "browser <%s>\\n" "$1" >> "$LOG"');
    const r = x.run([x.file, ...(open ? ['--open'] : []), ...(reopen ? ['--reopen'] : [])], { HC_TERMINAL_ID: terminal });
    assert.equal(r.status, 0, r.stderr);
    const lines = (await readFile(x.env.LOG, 'utf8')).trim().split('\n');
    assert.deepEqual(lines, [`lavish <${x.file}> <--no-open>${reopen ? ' <--reopen>' : ''}`, ...(terminal ? ['register'] : []), ...(open && !succeeds ? ['browser <http://localhost:123/review>'] : [])]);
    assert.match(r.stdout, succeeds ? /listed under the task's Artifacts/ : /ready: http:\/\/localhost:123\/review/);
  }
});
test('exit zero without acknowledgement is not registration and falls back only with --open', async t => {
  const x = await setup(t);
  await x.fakeJS('herdr-app', `require('node:fs').writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n')); console.log('{"ok":true}');`);
  const browserLog = path.join(x.dir, 'browser');
  await x.fake(process.platform === 'darwin' ? 'open' : 'xdg-open', 'printf "%s\\n" "$1" >> "$BROWSER_LOG"');
  for (const open of [false, true]) {
    const start = Date.now();
    const r = x.run([x.file, ...(open ? ['--open'] : [])], { HC_TERMINAL_ID:'unknown', BROWSER_LOG:browserLog });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.match(r.stdout, /ready: http:\/\/localhost:123\/review/);
    assert.ok(Date.now() - start < 4000, 'registration wait is bounded');
    await assertRegistration(x.env.LOG, { terminal:'unknown', path:x.file, title:'Page title' });
    if (open) assert.equal(await readFile(browserLog, 'utf8'), 'http://localhost:123/review\n');
    else await assert.rejects(access(browserLog));
  }
});
test('waits for acknowledgement after the queue command exits', async t => {
  const x = await setup(t);
  await x.fakeJS('herdr-app', `const fs = require('node:fs');
const payload = JSON.parse(process.argv[3].slice('task-tree.artifact:'.length));
if (fs.readFileSync(payload.ack, 'utf8') !== JSON.stringify({pending:true})) process.exit(1);
fs.writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n'));
require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ok:true})), 100)', payload.ack], {detached:true,stdio:'ignore'}).unref();`);
  const r = x.run([x.file], {HC_TERMINAL_ID:'terminal'});
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /listed under the task's Artifacts/);
  await assertRegistration(x.env.LOG, {terminal:'terminal',path:x.file,title:'Page title'});
});
test('registration rejection and hung queue commands clean up and remain optional', async t => {
  const x = await setup(t);
  for (const failure of ['rejected', 'negative', 'hung']) {
    await x.fakeJS('herdr-app', `const fs = require('node:fs');
fs.writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n'));
const payload = JSON.parse(process.argv[3].slice('task-tree.artifact:'.length));
${failure === 'rejected' ? 'process.exit(1);' : failure === 'negative' ? 'fs.writeFileSync(payload.ack, JSON.stringify({ok:false}));' : 'setInterval(() => {}, 1000);'}`);
    const start = Date.now(), r = x.run([x.file], { HC_TERMINAL_ID:'terminal' });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.match(r.stdout, /ready:/);
    assert.ok(Date.now() - start < 4000, 'submission and acknowledgement share a bounded wait');
    await assertRegistration(x.env.LOG, {terminal:'terminal',path:x.file,title:'Page title'});
  }
});
test('reports browser opener failure', async t => {
  const x = await setup(t); await x.fake(process.platform === 'darwin' ? 'open' : 'xdg-open', 'echo cannot-open >&2; exit 1');
  const r = x.run([x.file, '--open']); assert.equal(r.status, 1); assert.match(r.stderr, /cannot-open/);
});
test('first-use npm failure is reported and leaves no partial cache', async t => {
  const x = await setup(t); await x.fake('npm', 'echo network-broke >&2; exit 1');
  const data = path.join(x.dir, 'data'); const r = x.run([x.file], { XDG_DATA_HOME: data });
  assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /network-broke/); assert.match(r.stderr, /needs npm and network access; fix that and rerun the same lavish-view command/);
  assert.deepEqual(await readdir(path.join(data, 'lavish-view', 'deps')), []);
});
test('executable works through a deployed symlink', async t => {
  const x = await setup(t); const link = path.join(x.bin, 'lavish-view'); await symlink(cli, link);
  const r = spawnSync(link, [x.file], { cwd: x.dir, env: { ...x.env, PATH: `${x.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /http:\/\/localhost:123\/review/);
});
test('git watch updates data silently without rewriting shell', async t => {
  const x = await setup(t); const repo=path.join(x.dir,'repo'); await mkdir(repo);
  assert.equal(spawnSync('git',['init','-q','-b','main',repo]).status,0);
  const env={...x.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  await writeFile(path.join(repo,'x'),'one\n'); assert.equal(spawnSync('git',['add','x'],{cwd:repo,env}).status,0); assert.equal(spawnSync('git',['commit','-qm','first'],{cwd:repo,env}).status,0);
  await writeFile(path.join(repo,'x'),'two\n'); const out=path.join(x.dir,'out','index.html');
  const child=spawn(process.execPath,[cli,'diff','--git','--watch','--out',out],{cwd:repo,env,stdio:['ignore','pipe','pipe']}); t.after(()=>child.kill());
  let stdout='',stderr=''; child.stdout.on('data',data=>stdout+=data); child.stderr.on('data',data=>stderr+=data);
  const until=async fn=>{ const deadline=Date.now()+15000; while(Date.now()<deadline) { if(await fn()) return; await new Promise(resolve=>setTimeout(resolve,100)); } throw new Error(`watch timeout: ${stderr}`); };
  const latest=path.join(path.dirname(out),'latest.js'); await until(async()=>{try{return Boolean(await readFile(latest,'utf8'));}catch{return false;}});
  const before=await readFile(latest,'utf8'); const shellTime=(await import('node:fs/promises')).stat; const mtime=(await shellTime(out)).mtimeMs;
  await writeFile(path.join(repo,'x'),'three\n'); await until(async()=>await readFile(latest,'utf8')!==before);
  assert.equal((await shellTime(out)).mtimeMs,mtime); assert.equal(stdout.trim().split('\n').length,1); assert.equal(stderr,'');
});
test('diff argument errors name the conflicting or missing option', async t => {
  const x = await setup(t);
  for (const [args, message] of [[['diff','-r'], /-r requires/], [['diff','--repo-root','x'], /--repo-root requires/], [['diff','-','--watch'], /stdin conflicts/], [['diff','-r','a','--from','b','--to','c'], /-r conflicts/]]) {
    const result=x.run(args); assert.equal(result.status,2); assert.match(result.stderr,message);
  }
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
  const outsideTarget = path.join(x.dir, 'outside-target'); await writeFile(outsideTarget, 'untouched');
  const leaf = path.join(repo, 'leaf.html'); await symlink(outsideTarget, leaf);
  for (const args of [[md, '--out', leaf], ['diff', '--repo-root', repo, '-', '--out', leaf]]) {
    const r = x.run(args); assert.equal(r.status, 1); assert.match(r.stderr, /output inside/);
    assert.equal(await readFile(outsideTarget, 'utf8'), 'untouched');
    assert.equal(await (await import('node:fs/promises')).readlink(leaf), outsideTarget);
    await assert.rejects(access(path.join(repo, 'assets')));
  }
  const inward = path.join(x.dir, 'inward.html'); await symlink(md, inward);
  for (const args of [[md, '--out', inward], ['diff', '--repo-root', repo, '-', '--out', inward]]) {
    const r = x.run(args); assert.equal(r.status, 1); assert.match(r.stderr, /output inside/); assert.equal(await readFile(md, 'utf8'), '# test');
  }
  let r = x.run(['diff', '--repo-root', repo, '-'], { HOME: repo });
  assert.equal(r.status, 1); assert.match(r.stderr, /output inside/); await assert.rejects(access(path.join(repo, '.local')));
  const out = path.join(x.dir, 'outside', 'index.html'); r = x.run([md, '--out', out]);
  assert.equal(r.status, 0, r.stderr); assert.match(await readFile(out, 'utf8'), /<h1 id="test"[^>]*>/);
  r = x.run([x.file, '--out', out]); assert.equal(r.status, 0); assert.equal(await readFile(out, 'utf8'), '<title>Page title</title>');
  r = x.run([md], { HOME: repo }); assert.equal(r.status, 1); assert.match(r.stderr, /output inside/); await assert.rejects(access(path.join(repo, '.local')));
});
test('markdown title is registered and can be overridden', async t => {
  const x = await setup(t); await x.fakeJS('herdr-app', `${acknowledge}\nfs.writeFileSync(process.env.LOG, process.argv.slice(2).join('\\n'));`);
  const file = path.join(x.dir, 'doc.md'); await writeFile(file, '---\ntitle: "A & B"\n---\n# Heading');
  for (const [extra, title] of [[[], 'A & B'], [['--title', 'Override'], 'Override']]) {
    const out = path.join(x.dir, 'out.html');
    const r = x.run([file, '--out', out, ...extra], { HC_TERMINAL_ID: 'terminal' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /listed under the task's Artifacts/);
    await assertRegistration(x.env.LOG, { terminal: 'terminal', path: out, title });
  }
});
