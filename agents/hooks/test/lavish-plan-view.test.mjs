import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../lavish-plan-view', import.meta.url));

async function fixture(t, script = 'printf "%s\\n" "$@" > "$HOME/args"') {
  const home = await mkdtemp(join(tmpdir(), 'lavish-plan-hook-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'lavish-kit'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state'), PATH: `${bin}:${process.env.PATH}` };
  delete env.POLYTOKEN_SESSION_ID;
  return { home, env };
}

function run(env) {
  const result = spawnSync('bash', [hook], {
    env, input: '{"tool_name":"handoff_plan","input":{}}', encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

async function waitFor(file, ready = () => true) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    try {
      const text = await readFile(file, 'utf8');
      if (ready(text)) return text;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`hook command did not write expected content to ${file}`);
}

async function plan(home, session, name) {
  const dir = join(home, '.local/share/polytoken/sessions-v1', session);
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, '# Plan\n');
  return file;
}

test('detaches startup and opens the newest plan under Polytoken artifacts', async t => {
  const { home, env } = await fixture(t, 'printf "%s\\n" "$@" > "$HOME/args"; sleep 2; echo done > "$HOME/done"');
  env.POLYTOKEN_SESSION_ID = 'session with spaces';
  const newest = await plan(home, env.POLYTOKEN_SESSION_ID, 'plan-010.md');
  await plan(home, env.POLYTOKEN_SESSION_ID, 'plan-002.md');
  await plan(home, env.POLYTOKEN_SESSION_ID, 'plan-not-numbered.md');
  const start = performance.now();
  run(env);
  assert.ok(performance.now() - start < 1500, 'hook must not wait for command startup');
  assert.deepEqual((await waitFor(join(home, 'args'))).trimEnd().split('\n'), [
    newest, '--out', join(home, '.local/share/polytoken/artifacts/plan', env.POLYTOKEN_SESSION_ID, 'index.html'),
  ]);
  assert.match(await readFile(join(home, 'state/lavish-kit/plan-hook.log'), 'utf8'), /lavish-kit .* --out /);
  await waitFor(join(home, 'done'));
});

test('no session or missing plan exits silently without invoking lavish-kit', async t => {
  const { home, env } = await fixture(t);
  run(env);
  env.POLYTOKEN_SESSION_ID = 'missing';
  run(env);
  await assert.rejects(readFile(join(home, 'args')), { code: 'ENOENT' });
});

test('command failure is logged without failing the hook', async t => {
  const { home, env } = await fixture(t, 'echo failure >&2; exit 1');
  env.POLYTOKEN_SESSION_ID = 'session-1';
  await plan(home, env.POLYTOKEN_SESSION_ID, 'plan-001.md');
  run(env);
  assert.match(await waitFor(join(home, 'state/lavish-kit/plan-hook.log'), text => text.includes('failure')), /failure/);
});
