import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const self = path.relative(repo, fileURLToPath(import.meta.url));

function rg(pattern) {
  const result = spawnSync('rg', ['-n', '--glob', `!${self}`, pattern, '.'], { cwd: repo, encoding: 'utf8' });
  assert.ok(!result.error, `rg is required for this test: ${result.error?.message}`);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return result.stdout;
}

test('no references remain', () => {
  assert.equal(rg('jj-diff-html|jj-review|zed-review'), '');
});

test('no TODO(prose)', () => {
  assert.equal(rg('TODO\\(prose\\)'), '');
});

test('skills mention lavish-view', async () => {
  for (const skill of ['lavish', 'diff-review']) {
    const text = await readFile(path.join(repo, 'agents/skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /lavish-view/, skill);
    assert.doesNotMatch(text, /herdr-artifact|--no-open/, skill);
  }
  const readme = await readFile(path.join(repo, 'config/herdr-app/README.md'), 'utf8');
  assert.match(readme, /^## Lavish review pages$/m);
});
