const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const source = fs.readFileSync('config/herdr-app/mods/task-tree/main.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class', 'class');
let home = '/home/me', saved = [], calls = [], executor, delayChanges = false;
const changes = [];
const tasks = [];
let bindings = [], closedOverlay;
const cx = {spawn: fn => tasks.push(fn), notify() {}, focus_handle: () => ({}), stop_propagation() { this.stopped = true; },
  bind_keys(next) { bindings = next; return next.length; }};
const press = (picker, keystroke) => {
  const binding = bindings.find(b => b.keystroke === keystroke && b.context === 'TaskProjectPicker');
  assert.ok(binding, `Missing picker-scoped binding for ${keystroke}`);
  picker.pickerAction(binding.action, cx);
};
const sandbox = {
  View: class {}, home: () => home, props: () => ({projectPicker:true, overlay:'picker-test'}),
  closeOverlay: id => { closedOverlay = id; },
  VirtualListScrollHandle: {new: () => ({last:null, scroll_to_item(index, strategy) { this.last = [index, strategy]; }})},
  localStorage: {getItem: key => key === 'project-history' ? JSON.stringify(saved) : null},
  exec: (...args) => { calls.push(args); return executor(...args); },
  InputState: {new: (options = {}) => {
    const callbacks = {};
    return {text:'', focused:false, placeholder:options.placeholder, on: (event, fn) => { callbacks[event] = fn; }, focus() { this.focused = true; }, value() { return this.text; },
      set_value(text) { this.text = text; if (delayChanges) changes.push(() => callbacks.change?.({}, cx)); else callbacks.change?.({}, cx); }, submit() { callbacks.submit({}, cx); }};
  }},
};
const {TaskTree, fuzzyScore, pathQuery, projectScore, directoryRows} = vm.runInNewContext(source + '\n({TaskTree, fuzzyScore, pathQuery, projectScore, directoryRows})', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const make = () => { const picker = new TaskTree(); picker.init({}, cx); return picker; };
const drain = async () => { while (tasks.length) await tasks.shift()(cx); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
assert.ok(fuzzyScore('vendor', 'ven') < fuzzyScore('unvented', 'ven'));
assert.ok(Number.isFinite(fuzzyScore('repo', 'rp')));
assert.equal(fuzzyScore('repo', 'rx'), Infinity);
assert.deepEqual(plain(pathQuery('~/src/ven')), {parent:'~/src/', folder:'/home/me/src/', query:'ven'});
assert.deepEqual(plain(pathQuery('~')), {parent:'~/', folder:'/home/me/', query:''});
assert.equal(pathQuery('relative/path'), null); assert.equal(pathQuery('~other/'), null);
assert.equal(pathQuery('/').folder, '/');
assert.ok(Number.isFinite(projectScore({machine:null, root:'/home/me/src/vendor/repo'}, '~/sr/ven/rp')));
assert.equal(projectScore({machine:'remote', root:'/home/me/src/vendor/repo'}, '~/sr/ven/rp'), Infinity);
assert.equal(projectScore({root:'/home/me/srv/repo'}, '~/sr/vendor/repo'), Infinity);
assert.deepEqual(plain(directoryRows(['/tmp/source', '/tmp/src', '/tmp/nope'], 'sr')), ['/tmp/src', '/tmp/source']);

async function main() {
  saved = [{machine:null, root:'/home/me/src/vendor/repo'}, {machine:'remote', root:'/home/me/src/vendor/repo'}];
  executor = async () => ({code:0, stdout:''});
  let picker = make();
  picker.filter.set_value('~/sr/ven/rp'); await drain();
  assert.equal(picker.projectRows().length, 1);
  picker.completePath(cx); assert.equal(picker.filter.value(), '~/src/vendor/repo/'); await drain();
  picker.filter.set_value('remote rp'); await drain();
  assert.equal(picker.projectRows()[0].machine, 'remote');

  saved = [];
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'project-picker-'));
  try {
    home = fixture;
    for (const dir of ['src/vendor/repo', 'src/vendor/other', 'src/vendor-def', 'src/farm', 'src/fasten', '.hidden', 'src/with spaces', "src/quote'$(touch injected)", 'src/line\nbreak']) fs.mkdirSync(path.join(home, dir), {recursive:true});
    fs.writeFileSync(path.join(home, 'src/not-a-folder'), '');
    fs.symlinkSync(path.join(home, 'src/vendor'), path.join(home, 'src/link'), 'dir');
    executor = async (command, args, options) => {
      const result = child.spawnSync(command, args, {encoding:'utf8', timeout:options?.timeout});
      return {code:result.status ?? 1, stdout:result.stdout, stderr:result.stderr};
    };
    picker = make(); calls = [];
    picker.filter.set_value('~/sr');
    press(picker, 'tab'); // Tab while the listing is still pending.
    await drain(); assert.equal(picker.filter.value(), '~/src/');
    picker.filter.set_value('~/src/ven'); await drain();
    delayChanges = true;
    press(picker, 'tab'); assert.equal(picker.filter.value(), '~/src/vendor/');
    assert.equal(picker.projectChoices().length, 2);
    press(picker, 'tab'); assert.equal(picker.filter.value(), '~/src/vendor-def/');
    while (changes.length) changes.shift()(); delayChanges = false; await drain();
    assert.equal(picker.projectChoices().length, 2);
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/vendor/');
    picker.filter.set_value(picker.filter.value() + 'rp'); assert.equal(picker.completion, null); await drain();
    picker.completePath(cx); await drain(); assert.equal(picker.filter.value(), '~/src/vendor/repo/');
    let opened;
    picker.choosePath = value => { opened = value; };
    picker.filter.submit(); assert.equal(opened, path.join(home, 'src/vendor/repo'));
    picker.directoryCache[home + '/prefix/'] = [home + '/prefix/source', home + '/prefix/sources'];
    picker.filter.set_value('~/prefix/so'); press(picker, 'tab');
    assert.equal(picker.filter.value(), '~/prefix/source/');
    press(picker, 'tab'); assert.equal(picker.filter.value(), '~/prefix/sources/');
    press(picker, 'tab'); assert.equal(picker.filter.value(), '~/prefix/source/'); await drain();
    picker.filter.set_value('~/src/fa'); await drain();
    assert.equal(picker.folderRows().length, 2);
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/farm/');
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/fasten/');
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/farm/');
    press(picker, 'up'); press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/fasten/');
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/farm/');
    picker.fillPath(path.join(home, 'src/vendor'), cx); assert.equal(picker.completion, null); await drain();
    // Editing resets the snapshot. Selecting a row starts cycling at that row instead of the first.
    picker.filter.set_value('~/src/fa'); press(picker, 'down'); press(picker, 'down');
    assert.equal(cx.stopped, true); press(picker, 'tab'); await drain();
    assert.equal(picker.filter.value(), '~/src/fasten/');
    press(picker, 'tab'); await drain(); assert.equal(picker.filter.value(), '~/src/farm/');
    picker.filter.set_value('~/src/'); await drain();
    assert.ok(!picker.folderRows().some(p => p.endsWith('not-a-folder')));
    for (const name of ['link', 'with spaces', "quote'$(touch injected)", 'line\nbreak']) assert.ok(picker.folderRows().includes(path.join(home, 'src', name)));
    picker.filter.set_value('~/.hi'); await drain(); picker.completePath(cx); await drain(); assert.equal(picker.filter.value(), '~/.hidden/');
    picker.filter.set_value('~/src/quote'); await drain(); picker.completePath(cx); await drain();
    assert.equal(picker.filter.value(), "~/src/quote'$(touch injected)/");
    assert.equal(fs.existsSync(path.join(home, 'src/injected')), false);
    picker.filter.set_value(home + '/sr'); await drain(); picker.completePath(cx); await drain();
    assert.equal(picker.filter.value(), home + '/src/');
    picker.filter.set_value('~/src/missing/'); await drain(); assert.match(picker.directoryError, /Cannot list/);
    picker.filter.set_value('~/src/'); await drain(); assert.equal(picker.directoryError, null);
    press(picker, 'down'); const first = picker.selectedChoice;
    press(picker, 'up'); assert.notEqual(picker.selectedChoice, first);
    press(picker, 'down'); assert.equal(picker.selectedChoice, first);
    const selected = picker.projectChoices().find(row => row.id === first);
    picker.filter.submit(); assert.equal(opened, selected.path);
    // Same parent is read once while typing. Newly completed parents are listed independently.
    assert.equal(calls.filter(([,args]) => args.at(-1) === home + '/src/').length, 1);
  } finally { fs.rmSync(fixture, {recursive:true, force:true}); }

  home = '/home/me'; saved = [];
  const old = deferred(), current = deferred();
  executor = (_cmd, args) => args.at(-1) === '/old/' ? old.promise : current.promise;
  picker = make(); picker.filter.set_value('/old/a');
  const oldTask = tasks.shift()(cx);
  press(picker, 'tab');
  picker.filter.set_value('/new/b'); const newTask = tasks.shift()(cx);
  current.resolve({code:0, stdout:'/new/beta\0'}); await newTask;
  old.resolve({code:0, stdout:'/old/alpha\0'}); await oldTask;
  assert.equal(picker.filter.value(), '/new/b'); assert.deepEqual(plain(picker.folderRows()), ['/new/beta']);
  saved = [{machine:null, root:'/home/me/src/vendor/repo'}];
  const delayed = deferred(); executor = () => delayed.promise;
  picker = make(); picker.filter.set_value('~/sr'); const delayedTask = tasks.shift()(cx);
  press(picker, 'tab'); press(picker, 'down');
  assert.equal(picker.completeRequested, null); assert.deepEqual(picker.choiceScroll.last, [0, 'center']);
  delayed.resolve({code:0, stdout:'/home/me/src\0'}); await delayedTask;
  assert.equal(picker.filter.value(), '~/sr');
  assert.deepEqual(picker.choiceScroll.last, [1, 'center']); // Preserve visibility when a directory is inserted before history.
  saved = [{machine:null, root:'/home/me/src'}];
  const duplicate = deferred(); executor = () => duplicate.promise;
  picker = make(); picker.filter.set_value('~/sr'); const duplicateTask = tasks.shift()(cx);
  press(picker, 'down'); const savedChoice = picker.selectedChoice;
  duplicate.resolve({code:0, stdout:'/home/me/src\0'}); await duplicateTask;
  assert.equal(picker.projectChoices().length, 1); assert.equal(picker.projectChoices()[0].id, savedChoice);
  let selectedPath; picker.choosePath = value => { selectedPath = value; };
  picker.filter.submit(); assert.equal(selectedPath, '/home/me/src');
  saved = [];
  const late = deferred(); executor = () => late.promise;
  picker = make(); picker.filter.set_value('/late/l'); const closingTask = tasks.shift()(cx);
  press(picker, 'tab'); press(picker, 'escape');
  assert.equal(closedOverlay, 'picker-test'); assert.equal(picker.completeRequested, null); assert.equal(picker.closed, true);
  late.resolve({code:0, stdout:'/late/late\0'}); await closingTask;
  assert.equal(picker.directoryCache['/late/'], undefined);

  saved = [{machine:null, root:'/home/me/project-one'}, {machine:'build', root:'/home/me/project-one'}, {machine:null, root:'/home/me/project-two'}];
  executor = async () => ({code:0, stdout:''});
  picker = make(); picker.filter.set_value('project'); press(picker, 'tab'); await drain();
  assert.equal(picker.filter.value(), '/home/me/project-one/'); assert.equal(picker.projectChoices().length, 3);
  press(picker, 'down'); assert.equal(picker.projectChoices().find(row => row.id === picker.selectedChoice).project.machine, 'build');
  press(picker, 'tab'); assert.equal(picker.filter.value(), '/home/me/project-one/');
  press(picker, 'down'); press(picker, 'tab'); await drain();
  assert.equal(picker.filter.value(), '/home/me/project-two/'); assert.equal(picker.projectChoices().length, 3);
  assert.deepEqual(picker.choiceScroll.last, [2, 'center']);
  executor = async () => ({code:1, stdout:'', stderr:'could not open'});
  picker.chooseProject(saved[2], cx); assert.equal(picker.completion, null); await drain();
  assert.match(picker.error, /could not open/); assert.equal(picker.picking, false);
  press(picker, 'tab'); assert.equal(picker.filter.value(), '/home/me/project-two/'); assert.equal(picker.projectChoices().length, 1);
  await drain();

  // Input owns native keys. The picker registers scoped actions on its ancestor instead.
  let inLayout = false, list;
  const visibleText = [];
  const renderElement = () => {
    let proxy; const node = {events:{actions:{}}, children:[]};
    proxy = new Proxy(node, {get: (target, method) => method in target ? target[method] : (...args) => {
      if (method === 'when' && args[0]) args[1](proxy);
      if (method === 'track_focus') target.handle = args[0];
      if (method.startsWith('on_')) assert.equal(inLayout, false, 'Handlers are forbidden inside a virtual-list renderer');
      if (method === 'on_key_down') target.events.key = args[0];
      if (method === 'key_context') target.context = args[0];
      if (method === 'on_action') target.events.actions[args[0]] = args[1];
      if (method === 'id') target.id = args[0];
      if (method === 'child') { target.children.push(args[0]); if (typeof args[0] === 'string') visibleText.push(args[0]); }
      if (method === 'tooltip') target.tooltip = args[0];
      if (method === 'whitespace_nowrap') target.nowrap = true;
      if (method === 'text_ellipsis_middle') target.ellipsisMiddle = true;
      if (method === 'on_click') target.events.press = args[0];
      if (method === 'on_item_click') target.events.click = args[0];
      return proxy;
    }}); return proxy;
  };
  sandbox.div = sandbox.v_flex = sandbox.h_flex = renderElement; sandbox.theme = () => ({}); sandbox.Input = {new:renderElement};
  sandbox.v_virtual_list = (_id, count, _height, key, render) => {
    for (let i = 0; i < count; i++) assert.equal(typeof key(i), 'string');
    inLayout = true; let rows;
    try { rows = render({start:0, end:count}, cx); } finally { inLayout = false; }
    list = renderElement(); list.rows = rows; return list;
  };
  sandbox.Scrollbar = {vertical:renderElement};
  saved = [{machine:null, root:'/home/me/src/vendor/repo'}, {machine:null, root:'/home/me/src/vendor/other'}];
  picker = make(); const root = picker.projectPicker();
  assert.equal(root.handle, picker.handle); assert.equal(root.context, 'TaskProjectPicker');
  assert.equal(picker.filter.placeholder, 'Project or ~/path');
  assert.ok(visibleText.includes('~/src/vendor/repo'));
  assert.equal(list.rows[0].nowrap, true); assert.equal(list.rows[0].ellipsisMiddle, true);
  assert.equal(list.rows[0].tooltip, '/home/me/src/vendor/repo');
  assert.equal(typeof root.events.key, 'undefined'); // Completion must not depend on bubbling key delivery.
  assert.equal(bindings.length, 5);
  for (const binding of bindings) {
    assert.equal(binding.context, root.context); assert.equal(typeof root.events.actions[binding.action], 'function');
  }
  const dispatch = key => {
    const binding = bindings.find(b => b.keystroke === key && b.context === root.context);
    assert.ok(binding); cx.stopped = false;
    root.events.actions[binding.action]({action:binding.action}, cx); assert.equal(cx.stopped, true);
  };
  picker.filter.focused = false; dispatch('tab'); assert.equal(picker.filter.focused, true);
  assert.equal(picker.selectedChoice, picker.projectChoices()[0].id);
  dispatch('down'); assert.equal(picker.selectedChoice, picker.projectChoices()[1].id);
  picker.filter.focused = false; dispatch('shift-tab');
  assert.equal(picker.selectedChoice, picker.projectChoices()[0].id); assert.equal(picker.filter.focused, true);
  let clicked; picker.chooseProject = project => { clicked = project.root; };
  list.events.click(picker.projectChoices()[0].id, cx); assert.equal(clicked, saved[0].root);
  picker.filter.text = '~/src/'; picker.directoryCache['/home/me/src/'] = ['/home/me/src/vendor'];
  picker.projectPicker(); const id = picker.projectChoices()[0].id;
  picker.fillPath = value => { clicked = value; };
  list.events.click(id, cx); assert.equal(clicked, '/home/me/src/vendor');
  clicked = null; picker.directoryCache['/home/me/src/'] = []; picker.filter.text = 'nomatch';
  list.events.click(id, cx); assert.equal(clicked, null); // Ignore a click queued before filtering removed its key.
  executor = async () => ({code:0, stdout:''}); picker.fillPath = TaskTree.prototype.fillPath;
  picker.directoryCache['/home/me/src/'] = ['/home/me/src/vendor'];
  picker.filter.text = '~/src/ven'; picker.selectedChoice = null;
  dispatch('tab'); assert.equal(picker.filter.value(), '~/src/vendor/'); await drain();
  const find = (node, id) => node && typeof node === 'object' ? node.id === id ? node : node.children?.map(child => find(child,id)).find(Boolean) : null;
  picker.filter.text = '~/src/ven'; const withPath = picker.projectPicker();
  picker.filter.focused = false; find(withPath, 'project-complete').events.press({}, cx);
  assert.equal(picker.filter.value(), '~/src/vendor/'); assert.equal(picker.filter.focused, true); await drain();
  let openedPath; picker.choosePath = value => { openedPath = value; };
  find(withPath, 'project-path').events.press({}, cx); assert.equal(openedPath, '/home/me/src/vendor');
  assert.equal(find(withPath, 'project-complete').tooltip, 'Complete / cycle matches (Tab)');
  assert.equal(find(withPath, 'project-close').tooltip, 'Close (Esc)');
  assert.ok(visibleText.includes('⇥')); assert.ok(visibleText.includes('×'));
  assert.ok(visibleText.every(text => !text.startsWith('Tab:') && !text.startsWith('Tab cycles') && !text.startsWith('Open folder:') && !text.startsWith('local:')));
  picker.directoryError = 'Cannot list this folder';
  const failedListing = picker.projectPicker();
  assert.equal(find(failedListing, 'project-directory-error').tooltip, picker.directoryError);
  assert.ok(picker.projectChoices().length > 0); assert.ok(visibleText.includes(picker.directoryError));
  picker.directoryError = null;
  closedOverlay = null; dispatch('escape'); assert.equal(closedOverlay, 'picker-test'); assert.equal(picker.closed, true);
  picker = make(); const reopened = picker.projectPicker();
  closedOverlay = null; find(reopened, 'project-close').events.press({}, cx); assert.equal(closedOverlay, 'picker-test');
  saved = []; visibleText.length = 0; picker = make(); picker.projectPicker();
  assert.ok(!visibleText.includes('No matches')); // The empty initial picker needs no extra instructions.
  picker.filter.text = '/loading/'; picker.directoryPending['/loading/'] = true; picker.projectPicker();
  assert.ok(visibleText.includes('Loading folders…'));
  delete picker.directoryPending['/loading/']; picker.directoryError = 'Folder unavailable'; picker.projectPicker();
  assert.ok(visibleText.includes('Folder unavailable'));
  if (process.argv.includes('--native')) {
    const mod = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-picker-check-'));
    try {
      const directory = 'config/herdr-app/mods/task-tree';
      const nativeSource = fs.readFileSync(path.join(directory, 'main.js'), 'utf8');
      assert.equal(nativeSource.split('props()?.projectPicker').length - 1, 2);
      // Force check's otherwise empty props through picker init/render, without modifying the real mod.
      fs.writeFileSync(path.join(mod, 'main.js'), nativeSource.replaceAll('props()', '({projectPicker:true})'));
      for (const file of ['mod.json', 'doc-logic.js', 'artifact-logic.js']) fs.copyFileSync(path.join(directory,file), path.join(mod,file));
      const result = child.spawnSync('herdr-app', ['check', mod], {encoding:'utf8', timeout:30000});
      assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
      console.log('native project picker check passed');
    } finally { fs.rmSync(mod, {recursive:true, force:true}); }
  }
  console.log('project picker tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
