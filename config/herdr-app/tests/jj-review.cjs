const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// main.js imports modules that only exist inside herdr-app, so drop the imports
// and evaluate it in a sandbox to reach the pure diff and message functions.
const source = fs.readFileSync('config/herdr-app/mods/jj-review/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');
const { diffRows, diffFiles, formatMessage, itemKey, draftLines } = vm.runInNewContext(source + '\n({diffRows, diffFiles, formatMessage, itemKey, draftLines})', { View: class {} });
const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -2,3 +2,3 @@
 same
-old
+new
 tail
diff --git a/b.txt b/b.txt
new file mode 100644
--- /dev/null
+++ b/b.txt
@@ -0,0 +1 @@
+added
`;
const rows = diffRows(diff);
assert.equal(rows.filter(r => r.kind === 'file').length, 2);
for (const suffix of ['--- a/folder b/file.js\n+++ b/folder b/file.js\n@@ -1 +1 @@\n-old\n+new', '--- a/folder b/file.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-old', 'old mode 100644\nnew mode 100755']) assert.ok(diffRows(`diff --git a/folder b/file.js b/folder b/file.js\n${suffix}\n`).every(r => !r.path || r.path === 'folder b/file.js'));
assert.equal(diffRows('diff --git a/old.js b/folder b/new.js\nsimilarity index 100%\nrename from old.js\nrename to folder b/new.js\n')[0].path, 'folder b/new.js');
assert.deepEqual(JSON.parse(JSON.stringify(diffRows('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n'))), [{kind:'file',path:'image.png'}]);
assert.deepEqual(JSON.parse(JSON.stringify(rows.filter(r => [' ', '-', '+'].includes(r.kind)))), [
  {kind:' ',path:'a.txt',old:2,next:2,text:'same'},
  {kind:'-',path:'a.txt',old:3,text:'old'},
  {kind:'+',path:'a.txt',next:3,text:'new'},
  {kind:' ',path:'a.txt',old:4,next:4,text:'tail'},
  {kind:'+',path:'b.txt',next:1,text:'added'},
]);
assert.equal(formatMessage('/repo', '@-', [{row:rows[3],text:'Fix this'}, {row:rows[0],text:'Whole file'}]),
  'Review comments on `jj diff -r @-` in /repo:\n\n- a.txt:3 (deleted line) (`old`)\n  Fix this\n- a.txt (file)\n  Whole file');
const plain = x => JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(diffFiles(diff)), [
  {path:'a.txt',old:'a.txt',next:'a.txt',added:1,removed:1,binary:false},
  {path:'b.txt',old:null,next:'b.txt',added:1,removed:0,binary:false},
]);
assert.deepEqual(plain(diffFiles('diff --git a/old.js b/new.js\nsimilarity index 100%\nrename from old.js\nrename to new.js\n')), [{path:'new.js',old:'old.js',next:'new.js',added:0,removed:0,binary:false}]);
assert.deepEqual(plain(diffFiles('diff --git a/gone b/gone\ndeleted file mode 100644\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n')), [{path:'gone',old:'gone',next:null,added:0,removed:1,binary:false}]);
assert.equal(diffFiles('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n')[0].binary, true);
const items = rows.map(row => ({type:'diff',row}));
assert.equal(new Set(items.map(itemKey)).size, items.length);
assert.equal(itemKey(items[3]), itemKey({type:'diff', row:{...items[3].row}}));
assert.notEqual(itemKey({type:'comment',row:rows[0]}), itemKey({type:'viewed',row:rows[0]}));
assert.notEqual(itemKey({type:'draft',draft:{id:1}}), itemKey({type:'draft',draft:{id:2}}));
assert.deepEqual(plain(draftLines('alpha beta gamma', 10)), ['alpha ', 'beta gamma']);
assert.deepEqual(plain(draftLines('alpha beta gamma', 6)), ['alpha ', 'beta ', 'gamma']);
assert.deepEqual(plain(draftLines('abcdefghijk\nlast', 4)), ['abcd', 'efgh', 'ijk', 'last']);
assert.deepEqual(plain(draftLines('\n💡💡💡', 2)), ['', '💡💡', '💡']);
assert.deepEqual(plain(draftLines('a b', 1)), ['a', ' ', 'b']);
assert.equal(formatMessage('/repo', '@', [{row:diffRows('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n')[0],text:'Check it'}]), 'Review comments on `jj diff -r @` in /repo:\n\n- image.png (file)\n  Check it');
// Exercise the list-level handler without posting events to the desktop.
let rendered, click, resize, heights;
const element = () => new Proxy({}, {get: (_target, method) => (...args) => {
  if (method === 'when') { if (args[0]) args[1](element()); return element(); }
  if (method === 'on_item_click') click = args[0];
  if (method === 'on_size_change') resize = args[0];
  return element();
}});
const Review = vm.runInNewContext(source + '\nReview', {
  View: class {}, div:element, v_flex:element, h_flex:element,
  v_virtual_list: (_id, count, sizes, key) => { heights = sizes; rendered = Array.from({length:count}, (_, i) => key(i)); return element(); },
  Scrollbar:{vertical:element}, panes:() => [], settings:() => ({}),
  theme:() => ({background:'#000000',foreground:'#ffffff',raised:'#222222',dim:'#888888',accent:'#ffffff',ansi1:'#ff0000',ansi2:'#00ff00'}),
});
const review = new Review(), binaryRow = diffRows('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n')[0];
Object.assign(review, {rows:[binaryRow],files:[{path:'image.png',added:0,removed:0}],collapsed:{'image.png':true},viewed:{},drafts:[],selected:null,input:{set_value(){},focus(){this.focused = true}},scroll:{}});
const cx = {notify(){}};
review.render(cx);
const commentKey = itemKey({type:'comment',row:binaryRow});
assert.ok(rendered.includes(commentKey));
click(commentKey, cx);
assert.equal(review.selected, binaryRow); assert.equal(review.input.focused, true);
review.rows.unshift(rows[0]); review.files.unshift({path:'a.txt',added:1,removed:1});
review.render(cx); click(commentKey, cx);
assert.equal(review.selected, binaryRow);
review.drafts.push({id:42,row:binaryRow,text:'one two three four five six seven eight nine ten'});
let notifications = 0;
resize({width:150,height:400}, {notify(){notifications++;}});
review.render(cx);
const draftKey = itemKey({type:'draft',draft:{id:42}}), narrowHeight = heights[rendered.indexOf(draftKey)];
resize({width:500,height:400}, {notify(){notifications++;}});
review.render(cx);
const wideHeight = heights[rendered.indexOf(draftKey)];
assert.ok(narrowHeight > wideHeight);
assert.equal(wideHeight, (draftLines(review.drafts[0].text, Math.floor((500 - 56) / (14 * 0.7))).length + 1) * Math.ceil(14 * 1.65) + 18);
resize({width:500,height:450}, {notify(){notifications++;}});
assert.equal(notifications, 2);
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-review-test-'));
try {
  const bin = path.join(temp, 'bin'), snapshots = path.join(temp, 'snapshots');
  fs.mkdirSync(bin); fs.mkdirSync(snapshots);
  fs.writeFileSync(path.join(bin, 'jj'), '#!/bin/sh\n[ "$FAIL_JJ" != 1 ] || exit 3\necho old\n', {mode:0o755});
  fs.writeFileSync(path.join(bin, 'zed'), '#!/bin/sh\n[ "$FAIL_ZED" != 1 ]\n', {mode:0o755});
  const old = path.join(snapshots, 'jj-review-diff.12345678');
  fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'file'), 'old');
  const age = new Date(Date.now() - 3 * 86400000); fs.utimesSync(old, age, age);
  const run = extra => spawnSync('bash', ['config/herdr-app/mods/jj-review/open-diff', temp, '@', JSON.stringify([{path:'a', old:'a', next:'a'}])], {env:{...process.env, PATH:bin + path.delimiter + process.env.PATH, TMPDIR:snapshots, ...extra}});
  assert.equal(run({FAIL_JJ:'1'}).status, 3);
  assert.deepEqual(fs.readdirSync(snapshots), [path.basename(old)]);
  assert.notEqual(run({FAIL_ZED:'1'}).status, 0);
  assert.deepEqual(fs.readdirSync(snapshots), [path.basename(old)]);
  assert.equal(run({}).status, 0);
  assert.equal(fs.readdirSync(snapshots).length, 2);
  assert.equal(fs.readFileSync(path.join(old, 'file'), 'utf8'), 'old');
} finally { fs.rmSync(temp, {recursive:true, force:true}); }
console.log('jj-review logic tests passed');
