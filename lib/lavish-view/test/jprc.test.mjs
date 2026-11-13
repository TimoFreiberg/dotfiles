import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fishQuote } from '../src/pr-action.mjs';
import { preparePR } from '../src/pr-page.mjs';
const functionFile = path.resolve(import.meta.dirname, '../../../config/fish/functions/jprc.fish');

test('jprc --body-file uses exact title/body; existing PR and no-flag paths stay unchanged', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-jprc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo'), origin = path.join(dir, 'fake-origin.git'), bin = path.join(dir, 'bin'), log = path.join(dir, 'gh-args');
  await mkdir(repo); await mkdir(bin);
  const run = (name, args, options = {}) => execFileSync(name, args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
  run('git', ['init', '--bare', origin]); run('jj', ['git', 'init', '--colocate']);
  run('jj', ['config', 'set', '--repo', 'user.name', 'Test']); run('jj', ['config', 'set', '--repo', 'user.email', 'test@example.invalid']);
  const template = '## Checklist\n\n- [ ] Test\n';
  await writeFile(path.join(repo, 'PULL_REQUEST_TEMPLATE.md'), template);
  run('jj', ['commit', '-m', 'Base']); run('jj', ['bookmark', 'create', 'main', '-r', '@-']);
  run('jj', ['git', 'remote', 'add', 'origin', origin]); run('jj', ['git', 'push', '--bookmark', 'main']);
  await writeFile(path.join(repo, 'change.txt'), 'Change\n');
  run('jj', ['commit', '-m', 'Commit title\n\nCommit body']); run('jj', ['bookmark', 'create', 'draft-test', '-r', '@-']);
  const metadata = await preparePR('@-', repo);
  assert.equal(metadata.repo, await realpath(repo));
  assert.equal(metadata.rev, '@-'); assert.match(metadata.head, /^[a-f0-9]{40}$/);
  assert.ok(metadata.commits.some(line => line.endsWith('Commit title')));
  await assert.rejects(preparePR('root() | @', repo), /exactly one commit/);
  await assert.rejects(preparePR('missing_revision', repo));
  const stub = `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.GH_LOG,JSON.stringify(args)+'\\n'); if(args[1]==='list' && process.env.EXISTING_PR) console.log('https://example.invalid/pull/1');\n`;
  await writeFile(path.join(bin, 'gh'), stub); await chmod(path.join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log };
  const invoke = (args, extra = {}) => spawnSync('fish', ['--no-config', '-c', `source ${fishQuote(functionFile)}; jprc ${args.map(fishQuote).join(' ')}`], { cwd: repo, env: { ...env, ...extra }, input: 'y\n', encoding: 'utf8' });
  const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const title = 'Draft "quoted" title 雪', body = '\nBody \' \\ $HOME ; (false)\n\nSecond paragraph\n\n';
  const file = path.join(dir, "draft ' file.md"); await writeFile(file, `# ${title}\n${body}`);
  let result = invoke(['-r', '@-', '-b', 'main', '--body-file', file]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  let create = (await calls()).find(args => args[1] === 'create');
  assert.deepEqual(create, ['pr', 'create', '--head', 'draft-test', '--base', 'main', '--title', title, '--body', body, '--web']);
  await writeFile(log, '');
  result = invoke(['-r', '@-', '-b', 'main']); assert.equal(result.status, 0, result.stderr + result.stdout);
  create = (await calls()).find(args => args[1] === 'create');
  assert.ok(!create.includes('--title')); assert.equal(create[create.indexOf('--body') + 1], `Commit title  Commit body\n\n${template.trimEnd()}`, 'preserve existing fish commit-description normalization');
  await writeFile(log, '');
  result = invoke(['-r', '@-', '-b', 'main', '--body-file', path.join(dir, 'missing')], { EXISTING_PR: '1' });
  assert.equal(result.status, 0, result.stderr + result.stdout); assert.deepEqual((await calls()).at(-1), ['pr', 'view', 'https://example.invalid/pull/1', '--web']);
  for (const text of ['Not a title\nbody', '# \nbody', '#    \nbody']) {
    await writeFile(file, text); await writeFile(log, ''); result = invoke(['-r', '@-', '-b', 'main', '--body-file', file]);
    assert.equal(result.status, 1); assert.match(result.stderr, /first line/); assert.ok(!(await calls()).some(args => args[1] === 'create'));
  }
  await writeFile(log, ''); result = invoke(['-r', '@-', '-b', 'main', '--body-file', path.join(dir, 'missing')]);
  assert.equal(result.status, 1); assert.match(result.stderr, /missing or unreadable/);
  // Every push goes only to the local bare repository, never to GitHub.
  assert.match(run('jj', ['git', 'remote', 'list']), /fake-origin\.git/);
});
