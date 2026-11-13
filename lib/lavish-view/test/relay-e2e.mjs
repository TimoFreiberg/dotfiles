// Run explicitly inside herdr: node lib/lavish-view/test/relay-e2e.mjs
// This creates and cleans up only its own scratch terminals and Lavish page.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, chmod, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { relayPaths, relayLog } from '../src/relay.mjs';
const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, '../../../bin/lavish-view');
const session = `lavish-relay-e2e-${process.pid}`;
const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-relay-e2e-'));
const file = path.join(dir, 'page.html');
const sourceFile = path.join(dir, 'task.md');
const prFile = path.join(dir, 'pr-page/index.html'), prSource = path.join(dir, 'pr.md');
const launchFile = path.join(dir, 'launch.json'), captureFile = path.join(dir, 'jprc.json');
const terminals = []; let browser, watcher, prWatcher, space;
let prOutput = '', prErrors = '';
let watcherOutput = '', watcherErrors = '';
const run = async (name, args, options = {}) => {
  const result = await exec(name, args, { ...options, maxBuffer: 4 * 1024 * 1024 });
  console.log(`$ ${name === process.execPath ? 'node' : name} ${args.join(' ')}`);
  return result.stdout;
};
const until = async fn => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('E2E readiness timeout');
};
try {
  for (const label of [session, `${session}-spare`]) {
    const result = JSON.parse(await run('herdr-app', ['do', space ? 'tab.new' : 'space.new', JSON.stringify({ ...(space ? { space } : { name: session }), folder: dir, argv: ['cat'] })]));
    space ||= result.space;
    assert.equal(result.space, space); assert.ok(result.terminal);
    terminals.push(result.terminal); console.log(`Created scratch terminal ${result.terminal} in ${space}`);
    await run('hc', ['label', result.terminal, `polytoken.session=${label}`]);
  }
  await writeFile(sourceFile, '# Relay E2E\n\nQuoted E2E context\n');
  console.log(`$ node ${cli} task ${sourceFile} --out ${file} --title Relay E2E`);
  watcher = spawn(process.execPath, [cli, 'task', sourceFile, '--out', file, '--title', 'Relay E2E'], { env: { ...process.env, HC_TERMINAL_ID: terminals[0] } });
  watcher.stdout.setEncoding('utf8'); watcher.stderr.setEncoding('utf8');
  watcher.stdout.on('data', chunk => watcherOutput += chunk); watcher.stderr.on('data', chunk => watcherErrors += chunk);
  await until(() => watcherOutput.includes('Lavish review'));
  console.log(watcherOutput.trim());
  assert.equal(JSON.parse(await readFile(relayPaths(file).target)).sourceFile, await realpath(sourceFile));
  // Querying open's URL does not create a second poll listener.
  const opened = await run('lavish-axi', [file, '--no-open']);
  const url = opened.match(/url:\s*"?(https?:\/\/[^"\s]+)/)?.[1]; assert.ok(url);
  browser = await chromium.launch({ executablePath: process.env.LAVISH_VIEW_CHROMIUM || chromium.executablePath(), headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => console.log(`Browser error: ${error.message}`));
  page.on('response', response => { if (response.request().method() === 'POST') console.log(`Browser POST ${new URL(response.url()).pathname}: ${response.status()}`); });
  await page.goto(url);
  const frame = page.frames().find(frame => frame !== page.mainFrame()); assert.ok(frame);
  await frame.waitForFunction(() => typeof window.lavish?.sendQueuedPrompts === 'function');
  for (const [index, text] of [[0, 'relay-e2e-first-comment'], [1, 'relay-e2e-moved-comment']]) {
    if (index) {
      await run('hc', ['label', terminals[0], `polytoken.session=${session}-retired`]);
      await run('hc', ['label', terminals[1], `polytoken.session=${session}`]);
    }
    await frame.evaluate(text => {
      window.lavish.queuePrompt(text, { tag: 'code-comment', text: 'Quoted E2E context', target: { path: 'example.md', line: 1 } });
      window.lavish.sendQueuedPrompts();
    }, text);
    let screen;
    try { await until(async () => { screen = (await exec('hc', ['read', terminals[index]])).stdout; return screen.includes(text); }); }
    catch (error) { console.log(`Conversation on failure:\n${await page.locator('body').innerText()}\nTerminal screen:\n${screen}`); throw error; }
    assert.match(screen, /Quoted E2E context/); assert.match(screen, /do not poll this page/);
    console.log(`hc read ${terminals[index]} confirmed ${text}:\n${screen.trim()}`);
    if (index) assert.ok(!(await exec('hc', ['read', terminals[0]])).stdout.includes(text), 'moved delivery must not reach the old terminal');
  }
  const editor = frame.getByRole('textbox', { name: 'Markdown text' });
  await until(async () => (await editor.inputValue()).includes('Quoted E2E context'));
  const saved = '# Saved from task page\n\n' + ('Odd " \\ Context data: </script> 雪 🦊\u2028\n').repeat(20000);
  await editor.fill('# Saved from task page\n');
  await editor.evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, saved);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => await readFile(sourceFile, 'utf8') === saved);
  let notice;
  await until(async () => { notice = (await exec('hc', ['read', terminals[1]])).stdout; return notice.includes('The user edited') && notice.includes(sourceFile); });
  assert.ok(!notice.includes('Odd "'), 'full save contents must not reach the agent');
  await until(async () => (await frame.getByRole('status').innerText()).includes('Up to date with disk'));
  assert.equal(await editor.inputValue(), saved);
  console.log(`PASS: Save button wrote ${Buffer.byteLength(saved)} UTF-8 bytes exactly; watched page updated without reload.`);
  console.log(`hc read ${terminals[1]} confirmed short save notice:\n${notice.trim()}`);
  await run('lavish-axi', ['end', file]);
  await until(async () => { try { await access(relayPaths(file).lock); return false; } catch { return true; } });
  console.log('PASS: browser queue-and-send, delivery, moved session, and relay exit');

  // Real tab.new, with only its child environment changed to load scratch stubs.
  // The app/core does not inherit the watcher's PATH, so inject the stub config
  // into the argv at the CLI boundary instead of relying on that inheritance.
  const bin = path.join(dir, 'bin'), config = path.join(dir, 'config');
  await mkdir(bin); await mkdir(path.join(config, 'fish/functions'), { recursive: true });
  await writeFile(path.join(config, 'fish/functions/jprc.fish'), 'function jprc; command jprc $argv; end\n');
  const executable = async (name, script) => { const file = path.join(bin, name); await writeFile(file, `#!${process.execPath}\n${script}\n`); await chmod(file, 0o755); };
  await executable('gh', `console.log('stub-gh: no GitHub access');`);
  await executable('jprc', `const fs=require('node:fs'), cp=require('node:child_process'); const args=process.argv.slice(2); const source=args[args.indexOf('--body-file')+1]; fs.writeFileSync(${JSON.stringify(captureFile)},JSON.stringify({args,cwd:process.cwd(),terminal:process.env.HC_TERMINAL_ID,text:fs.readFileSync(source,'utf8')})); console.log('stub-jprc: '+JSON.stringify(args)); cp.execFileSync(${JSON.stringify(path.join(bin, 'gh'))},['pr','create','--web'],{stdio:'inherit'});`);
  const realApp = (await exec('which', ['herdr-app'])).stdout.trim();
  await executable('herdr-app', `const fs=require('node:fs'), cp=require('node:child_process'); const args=process.argv.slice(2); if(args[0]==='do' && args[1]==='tab.new'){ const request=JSON.parse(args[2]); if(request.argv[0]!=='fish') throw Error('unexpected launch'); request.argv=['env',${JSON.stringify(`XDG_CONFIG_HOME=${config}`)},${JSON.stringify(`PATH=${bin}:${process.env.PATH}`)},...request.argv]; args[2]=JSON.stringify(request); const output=cp.execFileSync(${JSON.stringify(realApp)},args,{encoding:'utf8'}); fs.writeFileSync(${JSON.stringify(launchFile)},output); process.stdout.write(output); } else {process.stdout.write(cp.execFileSync(${JSON.stringify(realApp)},args,{encoding:'utf8'}));}`);
  await writeFile(prSource, '# PR E2E title\n\nInitial PR body\n');
  console.log(`$ node ${cli} pr ${prSource} -r @- --out ${prFile}`);
  prWatcher = spawn(process.execPath, [cli, 'pr', prSource, '-r', '@-', '--out', prFile], { env: { ...process.env, HC_TERMINAL_ID: terminals[1], PATH: `${bin}:${process.env.PATH}` } });
  prWatcher.stdout.setEncoding('utf8'); prWatcher.stderr.setEncoding('utf8');
  prWatcher.stdout.on('data', chunk => prOutput += chunk); prWatcher.stderr.on('data', chunk => prErrors += chunk);
  await until(() => prOutput.includes('Lavish review')); console.log(prOutput.trim());
  const prTarget = JSON.parse(await readFile(relayPaths(prFile).target));
  assert.equal(prTarget.pr.repo, await realpath(process.cwd())); assert.equal(prTarget.pr.rev, '@-');
  const prOpened = await run('lavish-axi', [prFile, '--no-open']);
  const prURL = prOpened.match(/url:\s*"?(https?:\/\/[^"\s]+)/)?.[1]; assert.ok(prURL);
  const prPage = await browser.newPage(); await prPage.goto(prURL);
  const prFrame = prPage.locator('iframe').first().contentFrame();
  const title = prFrame.getByRole('textbox', { name: 'Title', exact: true }), body = prFrame.getByRole('textbox', { name: 'PR body' });
  await prFrame.getByRole('status').filter({ hasText: 'Up to date with disk' }).waitFor();
  await title.fill('Saved PR title'); await body.fill('\nSaved PR body 雪\n\n');
  await prFrame.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => await readFile(prSource, 'utf8') === '# Saved PR title\n\nSaved PR body 雪\n\n');
  await prFrame.getByRole('status').filter({ hasText: 'Up to date with disk' }).waitFor();
  console.log('PASS: PR page Save wrote title and body exactly and watched the save.');
  await title.fill('Create PR title'); await body.fill('\nCreate PR body " \\ 雪\n\n');
  const actionText = '# Create PR title\n\nCreate PR body " \\ 雪\n\n';
  await prFrame.getByRole('button', { name: 'Create PR', exact: true }).click();
  let launch, captured;
  await until(async () => { try { launch = JSON.parse(await readFile(launchFile)); captured = JSON.parse(await readFile(captureFile)); return true; } catch { return false; } });
  terminals.push(launch.terminal);
  assert.equal(launch.space, space); assert.equal(captured.cwd, prTarget.pr.repo);
  assert.deepEqual(captured.args, ['-r', '@-', '--body-file', await realpath(prSource)]); assert.equal(captured.text, actionText);
  const actual = JSON.parse(await run('hc', ['get', launch.terminal, '--json']));
  assert.equal(actual.labels['herdr.space'], space); assert.equal(actual.labels['herdr.tab'], launch.tab);
  await until(async () => (await exec('hc', ['read', launch.terminal])).stdout.includes('stub-gh: no GitHub access'));
  console.log(`Create PR launch: ${JSON.stringify(launch)}; hc get confirms space/tab labels.`);
  console.log(`Captured stub jprc: ${JSON.stringify(captured)}`);
  console.log(`hc read ${launch.terminal}:\n${(await run('hc', ['read', launch.terminal])).trim()}`);
  await until(async () => (await prPage.locator('body').innerText()).includes('Saved. Launched'));
  await run('lavish-axi', ['end', prFile]);
  await until(async () => { try { await access(relayPaths(prFile).lock); return false; } catch { return true; } });
  console.log('PASS: Create PR saved first, launched stub jprc/gh in the same herdr space and recorded repo, replied, and exited its relay.');
} finally {
  if (watcherErrors) console.log(`Task watcher stderr: ${watcherErrors.trim()}`);
  if (prErrors) console.log(`PR watcher stderr: ${prErrors.trim()}`);
  for (const child of [watcher, prWatcher]) if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM'); await stopped;
  }
  if (browser) await browser.close();
  for (const page of [file, prFile]) {
    try { await exec('lavish-axi', ['end', page]); } catch {}
    try {
      process.kill(Number(await readFile(path.join(relayPaths(page).lock, 'pid'))), 'SIGTERM');
      await until(async () => { try { await access(relayPaths(page).lock); return false; } catch { return true; } });
    } catch {}
    try { await rm(relayLog(await realpath(page)), { force: true }); } catch {}
  }
  // Include a launched terminal even if an assertion failed before capture was read.
  if (space) {
    try {
      const owned = JSON.parse((await exec('herdr-app', ['ls'])).stdout).spaces.find(item => item.id === space);
      terminals.push(...(owned?.tabs || []).flatMap(tab => tab.terminals.map(item => item.terminal)));
    } catch {}
    try { await run('herdr-app', ['do', 'space.close', JSON.stringify({ id: space, confirmed: true })]); } catch {}
  }
  for (const terminal of new Set(terminals)) {
    try { await run('hc', ['kill', terminal]); } catch {}
    try { await run('hc', ['rm', terminal]); } catch {}
  }
  await rm(dir, { recursive: true, force: true });
}
