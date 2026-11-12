import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { writeDiffPage, pagePath } from '../src/diff/page.mjs';

test('data scripts round-trip hostile patch; shell stays fixed and only two data versions survive', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-page-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const dist = path.join(dir,'dist'); await mkdir(dist); await writeFile(path.join(dist,'diff-app.js'),'');
  const out = path.join(dir,'page','index.html');
  const source = {root:'/tmp/repo', range:'r', rangeSource:'test', rangeSpec:'r', revision:null, commits:[], generated:'now', kind:'stdin', patch:'</script> " \\ $& $\' $` $$ 😀 \u2028'};
  assert.equal(pagePath(source,out), out);
  let result = await writeDiffPage(source, dist, out);
  let captured; vm.runInNewContext(await readFile(path.join(path.dirname(out),`data-${result.patchHash}.js`),'utf8'), {globalThis:{lavishViewData: data => {captured=data;}}});
  assert.equal(captured.patch, source.patch);
  assert.match(await readFile(out, 'utf8'), /<html data-lavish-annotate="off">/);
  const before = (await stat(out)).mtimeMs;
  for (const patch of ['two','three']) { result=await writeDiffPage({...source,patch},dist,out); }
  assert.equal((await stat(out)).mtimeMs,before);
  assert.equal((await readdir(path.dirname(out))).filter(name=>name.startsWith('data-')).length,2);
  assert.match(await readFile(path.join(path.dirname(out),'latest.js'),'utf8'),new RegExp(result.patchHash));
});
