import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { prepareDiff, readDiff, DiffUsageError } from '../src/diff/source.mjs';

const run = (cwd, ...args) => execFileSync(args[0],args.slice(1),{cwd,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid',JJ_USER:'Test',JJ_EMAIL:'test@example.invalid'}}).trim();
test('git default, explicit ranges, stdin and errors', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'diff-source-')); t.after(()=>rm(root,{recursive:true,force:true}));
  run(root,'git','init','-q','-b','main'); await writeFile(path.join(root,'x'),'one\n'); run(root,'git','add','x'); run(root,'git','commit','-qm','first');
  const first=run(root,'git','rev-parse','HEAD'); await writeFile(path.join(root,'x'),'two\n');
  let source=await prepareDiff({},root), result=await readDiff(source); assert.equal(source.kind,'git'); assert.match(source.rangeSource,/main/); assert.match(result.patch,/\+two/);
  run(root,'git','add','x'); run(root,'git','commit','-qm','second'); const second=run(root,'git','rev-parse','HEAD');
  run(root,'git','branch','-m','unmatched'); await assert.rejects(prepareDiff({},root), /origin\/HEAD, origin\/main, origin\/master, main, master/);
  run(root,'git','branch','master',first); source=await prepareDiff({},root); assert.match(source.rangeSource,/master/);
  for (const options of [{rev:`${first}..${second}`},{from:first,to:second}]) { source=await prepareDiff(options,root); result=await readDiff(source); assert.match(result.patch,/\+two/); assert.equal(result.revision,second); }
  source=await prepareDiff({stdin:true,repoRoot:root},root); result=await readDiff(source,Readable.from(['hello'])); assert.equal(result.patch,'hello'); assert.equal(result.root,root);
  for (const options of [{repoRoot:root},{stdin:true,watch:true},{rev:'HEAD'},{from:'a'},{rev:'a..b',from:'a',to:'b'}]) await assert.rejects(prepareDiff(options,root),DiffUsageError);
});
test('streams a patch larger than five megabytes without a subprocess buffer limit', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'diff-large-')); t.after(()=>rm(root,{recursive:true,force:true}));
  run(root,'git','init','-q','-b','main'); await writeFile(path.join(root,'x'),'base\n'); run(root,'git','add','x'); run(root,'git','commit','-qm','first');
  const payload = Array.from({length: 520},(_,i) => `diff --git a/${i} b/${i}\n${'x'.repeat(10240)}\n`).join('');
  const start=performance.now(); const result=await readDiff(await prepareDiff({stdin:true,repoRoot:root},root),Readable.from([payload]));
  assert.ok(Buffer.byteLength(result.patch)>5_000_000); assert.equal(result.patch,payload);
  await writeFile(path.join(root,'x'), `${'abcdef0123456789\n'.repeat(320000)}`);
  const gitResult=await readDiff(await prepareDiff({git:true},root)); assert.ok(Buffer.byteLength(gitResult.patch)>5_000_000);
  console.log(`streamed stdin ${Buffer.byteLength(payload)} bytes and git ${Buffer.byteLength(gitResult.patch)} bytes in ${(performance.now()-start).toFixed(1)} ms`);
});
test('jj and colocated --git acquisition', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'diff-jj-')); t.after(()=>rm(root,{recursive:true,force:true}));
  run(root,'git','init','-q','-b','main'); await writeFile(path.join(root,'x'),'one\n'); run(root,'git','add','x'); run(root,'git','commit','-qm','first'); run(root,'jj','git','init','--colocate'); await writeFile(path.join(root,'x'),'two\n');
  for (const options of [{},{rev:'@'},{from:'@-',to:'@'}]) { const source=await prepareDiff(options,root); assert.equal(source.kind,'jj'); const result=await readDiff(source); assert.match(result.patch,/\+two/); assert.ok(source.rangeSource); assert.equal(result.revision, run(root,'jj','log','-r','@','--no-graph','-T','commit_id')); }
  const multi = await readDiff(await prepareDiff({rev:'@ | @-'},root)); assert.equal(multi.revision, null);
  const git=await prepareDiff({git:true},root); assert.equal(git.kind,'git'); assert.match((await readDiff(git)).patch,/\+two/);
});
