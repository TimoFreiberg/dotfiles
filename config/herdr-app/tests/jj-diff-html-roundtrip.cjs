const { execFileSync, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-review-test-'));
const repo = path.join(temp, 'repo');
const out = path.join(temp, 'review.html');
const script = path.resolve(__dirname, '../../../bin/jj-diff-html');
function jj(...args) { return execFileSync('jj', args, { cwd: repo, encoding: 'utf8' }); }
try {
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, 'tokens.txt'), "$& $' $` $$ </script> 😀 \u2028\n");
  const patch = jj('--config', 'diff.git.show-path-prefix=true', 'diff', '--git', '-r', '@');
  const bin = path.join(temp, 'bin'), capture = path.join(temp, 'registration.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'herdr-artifact'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)))\n', {mode:0o755});
  execFileSync(script, ['--out', out], { cwd: repo, env:{...process.env, PATH:bin + path.delimiter + process.env.PATH, CAPTURE:capture} });
  assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')), ['add', out]);
  const page = fs.readFileSync(out, 'utf8');
  const match = page.match(/<script type="application\/json" id="data">([^]*?)<\/script>/);
  assert.ok(match, 'embedded JSON script is present');
  assert.equal(JSON.parse(match[1]).patch, patch);
  assert.ok(patch.includes("$& $' $` $$ </script> 😀 \u2028"));
  const rejected = spawnSync(script, ['--out', path.join(repo, 'nested', 'review.html'), '--watch'], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /outside the reviewed repository/);
  assert.equal(fs.existsSync(path.join(repo, 'nested')), false);
  console.log('Round-trip and in-repository output rejection passed');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
