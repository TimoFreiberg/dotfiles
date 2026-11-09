import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
test('malformed chunk is retained and empty diff has no files', () => {
  const raw = 'diff --git a/bad b/bad\n@@ invalid\n+bad\n';
  const [file] = modelPatch(raw); assert.equal(file.raw, raw); assert.ok(file.parseError);
  assert.deepEqual(modelPatch(''), []);
});
