import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, chmod, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { commentLocation, zedCommand, zedUrl } from '../web/locations.mjs';
import { modelPatch, unquoteGitPath } from '../src/diff/model.mjs';

const chunk = (path, headers, body = '') => `diff --git a/${path} b/${path}\n${headers}${body}`;
test('preserves chunks and classifies changes and newline markers', () => {
  const patch = [
    chunk('added', 'new file mode 100644\nindex 0000000..1111111\n', '--- /dev/null\n+++ b/added\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n'),
    chunk('gone', 'deleted file mode 100644\nindex 1111111..0000000\n', '--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n\\ No newline at end of file\n'),
    chunk('mode', 'old mode 100644\nnew mode 100755\n'),
    chunk('link', 'old mode 100644\nnew mode 120000\n'),
    chunk('image', 'index aaaaaaa..bbbbbbb 100644\nBinary files a/image and b/image differ\n'),
    'diff --git a/old b/new\nrename from old\nrename to new\n',
    'diff --git a/old2 b/new2\nindex aaaaaaa..bbbbbbb 100644\nrename from old2\nrename to new2\n--- a/old2\n+++ b/new2\n@@ -1 +1 @@\n-a\n+b\n',
  ].join('');
  const files = modelPatch(patch);
  assert.equal(files.length, 7);
  assert.deepEqual(files.map(f => f.status), ['added','deleted','mode-only','type-change','binary','renamed','renamed']);
  assert.deepEqual(files[0].noNewlineAtEof, {old:false,new:true});
  assert.deepEqual(files[1].noNewlineAtEof, {old:true,new:false});
  assert.equal(files[5].oldPath, 'old'); assert.equal(files[5].newPath, 'new');
  assert.match(files[5].normalized, /similarity index 100%/); assert.match(files[6].normalized, /similarity index 50%/);
  assert.equal(files[5].viewedKey, `new:${createHash('sha1').update(files[5].raw).digest('hex')}`);
});
test('unquotes git octal UTF-8 and keeps spaces', () => {
  assert.equal(unquoteGitPath('"caf\\303\\251 file"'), 'café file');
  const [file] = modelPatch('diff --git "a/caf\\303\\251 file" "b/caf\\303\\251 file"\nindex 1111111..2222222 100644\n--- "a/caf\\303\\251 file"\n+++ "b/caf\\303\\251 file"\n@@ -1 +1 @@\n-x\n+y\n');
  assert.equal(file.oldPath, 'café file'); assert.equal(file.newPath, 'café file');
});
test('real git and jj patches retain special files and ambiguous paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diff-fixture-')); t.after(() => rm(root, {recursive:true, force:true}));
  const run = (...args) => execFileSync(args[0], args.slice(1), {cwd:root, encoding:'utf8', env:{...process.env, GIT_AUTHOR_NAME:'Test', GIT_AUTHOR_EMAIL:'test@example.invalid', GIT_COMMITTER_NAME:'Test', GIT_COMMITTER_EMAIL:'test@example.invalid', JJ_USER:'Test', JJ_EMAIL:'test@example.invalid'}});
  run('git','init','-q','-b','main'); await mkdir(path.join(root, 'dir b'));
  for (const [name, content] of Object.entries({'dir b/file.js':'old\n', 'pure':'same\n', 'edited':'one\ntwo\nthree\nfour\n', 'mode':'mode\n', 'type':'file\n', 'binary':Buffer.from([0,1,2]), 'gone':'gone', 'café file':'old\n'})) await writeFile(path.join(root,name), content);
  run('git','add','.'); run('git','commit','-qm','base'); run('jj','git','init','--colocate');
  await writeFile(path.join(root,'dir b/file.js'),'new\n'); await rename(path.join(root,'pure'),path.join(root,'pure new')); await rename(path.join(root,'edited'),path.join(root,'edited new')); await writeFile(path.join(root,'edited new'),'one\ntwo\nthree\nchanged\n');
  await chmod(path.join(root,'mode'),0o755); await rm(path.join(root,'type')); await symlink('mode',path.join(root,'type')); await writeFile(path.join(root,'binary'),Buffer.from([0,3,4])); await rm(path.join(root,'gone')); await writeFile(path.join(root,'added'),'new'); await writeFile(path.join(root,'café file'),'new\n');
  run('git','add','-A');
  for (const patch of [run('git','diff','--cached','--no-color','-M'), run('jj','--config','diff.git.show-path-prefix=true','diff','--git','-r','@')]) {
    const files = modelPatch(patch); assert.equal(files.length, (patch.match(/^diff --git /gm) || []).length);
    const byName = name => { const f = files.find(item => item.newPath === name); assert.ok(f, `missing ${name}: ${files.map(x=>x.newPath)}`); return f; };
    assert.equal(byName('dir b/file.js').oldPath,'dir b/file.js'); assert.equal(byName('dir b/file.js').parsed?.name,'dir b/file.js');
    assert.equal(commentLocation(byName('dir b/file.js'), {start:1,end:1,side:'additions'}, 'rev').where, 'dir b/file.js:1');
    assert.match(zedUrl(root, byName('dir b/file.js').newPath, 1), /dir%20b\/file\.js:1$/);
    assert.equal(byName('pure new').status,'renamed'); assert.equal(byName('pure new').oldPath,'pure');
    assert.equal(byName('edited new').status,'renamed'); assert.equal(byName('edited new').oldPath,'edited');
    assert.equal(byName('mode').status,'mode-only');
    const types = files.filter(f => f.newPath === 'type').map(f => f.status).sort(); assert.ok(JSON.stringify(types) === JSON.stringify(['type-change']) || JSON.stringify(types) === JSON.stringify(['added','deleted']), `type representation: ${types}`);
    assert.equal(byName('binary').status,'binary');
    assert.equal(byName('gone').status,'deleted'); assert.equal(byName('added').status,'added'); assert.equal(byName('added').noNewlineAtEof.new,true); assert.equal(byName('café file').oldPath,'café file');
  }
});
test('real git and jj preserve literal quotes and escapes in paths and locations', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diff-quoted-')); t.after(() => rm(root, {recursive:true, force:true}));
  const run = (...args) => execFileSync(args[0], args.slice(1), {cwd:root, encoding:'utf8', env:{...process.env, GIT_AUTHOR_NAME:'Test', GIT_AUTHOR_EMAIL:'test@example.invalid', GIT_COMMITTER_NAME:'Test', GIT_COMMITTER_EMAIL:'test@example.invalid', JJ_USER:'Test', JJ_EMAIL:'test@example.invalid'}});
  const modified = '"quoted"', escaped = '"tab\tback\\slash café"', oldName = '"old\\name"', newName = '"new\tname"';
  run('git','init','-q','-b','main');
  for (const name of [modified, escaped, oldName]) await writeFile(path.join(root, name), 'one\ntwo\nthree\nfour\n');
  run('git','add','.'); run('git','commit','-qm','base'); run('jj','git','init','--colocate');
  for (const name of [modified, escaped]) await writeFile(path.join(root, name), 'changed\ntwo\nthree\nfour\n');
  await rename(path.join(root, oldName), path.join(root, newName));
  await writeFile(path.join(root, newName), 'one\ntwo\nthree\nchanged\n');
  run('git','add','-A');
  for (const [source, patch] of [['git', run('git','diff','--cached','--no-color','-M')], ['jj', run('jj','--config','diff.git.show-path-prefix=true','diff','--git','-r','@')]]) {
    const files = modelPatch(patch);
    assert.equal(files.length, (patch.match(/^diff --git /gm) || []).length, source);
    for (const [oldPath, newPath, status] of [[modified, modified, 'modified'], [escaped, escaped, 'modified'], [oldName, newName, 'renamed']]) {
      const file = files.find(item => item.newPath === newPath);
      assert.ok(file, `${source}: missing ${JSON.stringify(newPath)}; got ${JSON.stringify(files.map(item => item.newPath))}`);
      assert.equal(file.oldPath, oldPath, source); assert.equal(file.status, status, source);
      for (const [side, expected] of [['deletions', oldPath], ['additions', newPath]]) {
        const location = commentLocation(file, {start:1,end:1,side}, 'rev');
        assert.equal(location.path, expected, source); assert.equal(location.where, `${expected}:1`, source);
        assert.equal(zedUrl(root, location.path, 1), `zed://file/${path.join(root, expected).split('/').map(encodeURIComponent).join('/')}:1`, source);
        assert.equal(zedCommand(root, location.path, 1), `zed '${path.join(root, expected)}:1'`, source);
      }
    }
  }
});
test('real git and jj preserve mode-only and pure rename paths with literal quotes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diff-raw-quotes-')); t.after(() => rm(root, {recursive:true, force:true}));
  const run = (...args) => execFileSync(args[0], args.slice(1), {cwd:root, encoding:'utf8', env:{...process.env, GIT_AUTHOR_NAME:'Test', GIT_AUTHOR_EMAIL:'test@example.invalid', GIT_COMMITTER_NAME:'Test', GIT_COMMITTER_EMAIL:'test@example.invalid', JJ_USER:'Test', JJ_EMAIL:'test@example.invalid'}});
  const unmatched = 'foo"bar', nested = '"/\\"', oldName = '"old\\"', newName = '"new\\"';
  const oldAmbiguous = 'old b/part', newAmbiguous = 'new b/part';
  run('git','init','-q','-b','main');
  for (const dir of ['"', 'old b', 'new b']) await mkdir(path.join(root, dir));
  for (const name of [unmatched, nested, oldName, oldAmbiguous]) await writeFile(path.join(root, name), `distinct ${name}\n`);
  run('git','add','.'); run('git','commit','-qm','base'); run('jj','git','init','--colocate');
  for (const name of [unmatched, nested]) await chmod(path.join(root, name), 0o755);
  await rename(path.join(root, oldName), path.join(root, newName));
  await rename(path.join(root, oldAmbiguous), path.join(root, newAmbiguous));
  run('git','add','-A');
  for (const [source, patch] of [['git', run('git','diff','--cached','--no-color','-M')], ['jj', run('jj','--config','diff.git.show-path-prefix=true','diff','--git','-r','@')]]) {
    const files = modelPatch(patch);
    assert.equal(files.length, 4, source);
    for (const [oldPath, newPath, status] of [[unmatched, unmatched, 'mode-only'], [nested, nested, 'mode-only'], [oldName, newName, 'renamed'], [oldAmbiguous, newAmbiguous, 'renamed']]) {
      const file = files.find(item => item.newPath === newPath);
      assert.ok(file, `${source}: missing ${JSON.stringify(newPath)}; got ${JSON.stringify(files.map(item => item.newPath))}\n${patch}`);
      assert.equal(file.oldPath, oldPath, source); assert.equal(file.status, status, source);
      for (const [side, expected] of [['deletions', oldPath], ['additions', newPath]]) {
        const location = commentLocation(file, {start:1,end:1,side}, 'rev');
        assert.equal(location.path, expected, source); assert.equal(location.where, `${expected}:1`, source);
        assert.equal(zedUrl(root, location.path, 1), `zed://file/${path.join(root, expected).split('/').map(encodeURIComponent).join('/')}:1`, source);
        assert.equal(zedCommand(root, location.path, 1), `zed '${path.join(root, expected)}:1'`, source);
      }
    }
  }
});
test('copy headers decode literal quotes and escapes exactly once', () => {
  const raw = 'diff --git "a/\\\"old\\\\name\\\"" "b/\\\"new\\tname\\\""\nsimilarity index 100%\ncopy from "\\\"old\\\\name\\\""\ncopy to "\\\"new\\tname\\\""\n';
  const [file] = modelPatch(raw);
  assert.equal(file.status, 'copied'); assert.equal(file.oldPath, '"old\\name"'); assert.equal(file.newPath, '"new\tname"');
  const [literal] = modelPatch('diff --git a/"old\\" b/"new\\"\ncopy from "old\\"\ncopy to "new\\"\n');
  assert.equal(literal.oldPath, '"old\\"'); assert.equal(literal.newPath, '"new\\"');
  const [ambiguous] = modelPatch('diff --git a/old b/part b/new b/part\ncopy from old b/part\ncopy to new b/part\n');
  assert.equal(ambiguous.oldPath, 'old b/part'); assert.equal(ambiguous.newPath, 'new b/part');
});
test('malformed chunk is retained and empty diff has no files', () => {
  const raw = 'diff --git a/bad b/bad\n@@ invalid\n+bad\n';
  const [file] = modelPatch(raw); assert.equal(file.raw, raw); assert.ok(file.parseError);
  assert.deepEqual(modelPatch(''), []);
});
