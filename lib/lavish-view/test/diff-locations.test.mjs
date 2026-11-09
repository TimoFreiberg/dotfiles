import test from 'node:test';
import assert from 'node:assert/strict';
import { zedUrl, zedCommand, commentLocation, quoteSelection } from '../web/locations.mjs';

test('Zed links encode each path segment and shell commands quote apostrophes', () => {
  assert.equal(zedUrl('/tmp/repo space', 'dir/é file.js', 42), 'zed://file//tmp/repo%20space/dir/%C3%A9%20file.js:42');
  assert.equal(zedCommand('/tmp/repo', "dir/o'h.js", 7), "zed '/tmp/repo/dir/o'\\''h.js:7'");
});

test('comment context uses old rename path, normalizes range and rejects mixed sides', () => {
  const file = { oldPath: 'old name', newPath: 'new name' };
  assert.deepEqual(commentLocation(file, { side: 'deletions', start: 5, end: 3 }, 'abc'), { side: 'old', path: 'old name', start: 3, end: 5, where: 'old name:3-5', revision: 'abc' });
  assert.equal(commentLocation(file, { side: 'deletions', endSide: 'additions', start: 1, end: 2 }, 'abc'), null);
  assert.equal(commentLocation(file, { start: 1, end: 1 }, null).where, 'new name:1');
});

test('quotes selected lines on requested side', () => {
  const parsed = { deletionLines: ['old\n', 'next\n'], additionLines: ['new\n'], hunks: [{ deletionStart: 2, deletionLineIndex: 0, deletionCount: 2, additionStart: 2, additionLineIndex: 0, additionCount: 1 }] };
  assert.equal(quoteSelection(parsed, { side: 'deletions', start: 2, end: 3 }), '2: old\n3: next');
});
