import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../../../agents/hooks/lavish-plan-view', import.meta.url));

async function fixture(t, script) {
  const home = await mkdtemp(join(tmpdir(), 'lavish-hook-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'lavish-view'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return { home, env: { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state'), PATH: `${bin}:${process.env.PATH}` } };
}

function run(env) {
  const start = performance.now();
  const result = spawnSync('bash', [hook], { env, input: '{"tool_name":"handoff_plan","input":{}}', encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.ok(performance.now() - start < 1000, 'hook must return within one second');
}

async function waitFor(path, ready = () => true) {
  for (let i = 0; i < 250; i++) {
    try {
      const content = await readFile(path, 'utf8');
      if (ready(content)) return content;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`child did not write expected content to ${path}`);
}

test('picks newest plan and detaches without output', async t => {
  const { home, env } = await fixture(t, 'printf "%s\\n" "$@" > "$HOME/args"; sleep 2; echo done > "$HOME/done"');
  env.POLYTOKEN_SESSION_ID = 'session-1';
  const dir = join(home, '.local/share/polytoken/sessions-v1/session-1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'plan-001.md'), 'one');
  await writeFile(join(dir, 'plan-002.md'), 'two');
  run(env);
  assert.deepEqual((await waitFor(join(home, 'args'))).trimEnd().split('\n'), [
    join(dir, 'plan-002.md'), '--out', join(home, '.local/share/polytoken/artifacts/plan/session-1/index.html'),
  ]);
  await waitFor(join(home, 'done'));
});

test('no session or missing plan exits silently', async t => {
  const { home, env } = await fixture(t, 'echo invoked > "$HOME/args"');
  delete env.POLYTOKEN_SESSION_ID;
  run(env);
  env.POLYTOKEN_SESSION_ID = 'missing';
  run(env);
  await assert.rejects(readFile(join(home, 'args')), { code: 'ENOENT' });
});

test('failed child is logged without affecting hook', async t => {
  const { home, env } = await fixture(t, 'echo failure >&2; exit 1');
  env.POLYTOKEN_SESSION_ID = 'session-1';
  const dir = join(home, '.local/share/polytoken/sessions-v1/session-1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'plan-001.md'), 'one');
  run(env);
  assert.match(await waitFor(join(home, 'state/lavish-view/plan-hook.log'), text => text.includes('failure')), /failure/);
});
