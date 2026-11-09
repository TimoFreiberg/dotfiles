const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const source = fs.readFileSync('config/herdr-app/mods/task-tree/main.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class', 'class');
let home = '/home/me', saved = [], calls = [], executor;
const tasks = [];
const cx = {spawn: fn => tasks.push(fn), notify() {}, focus_handle: () => ({}) , stop_propagation() { this.stopped = true; }};
const sandbox = {
  View: class {}, home: () => home, props: () => ({projectPicker:true}),
  VirtualListScrollHandle: {new: () => ({last:null, scroll_to_item(index, strategy) { this.last = [index, strategy]; }})},
  localStorage: {getItem: key => key === 'project-history' ? JSON.stringify(saved) : null},
  exec: (...args) => { calls.push(args); return executor(...args); },
  InputState: {new: () => {
    const callbacks = {};
    return {text:'', on: (event, fn) => { callbacks[event] = fn; }, focus() {}, value() { return this.text; },
      set_value(text) { this.text = text; callbacks.change?.({}, cx); }, submit() { callbacks.submit({}, cx); }};
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
    for (const dir of ['src/vendor/repo', 'src/vendor/other', 'src/farm', 'src/fasten', '.hidden', 'src/with spaces', "src/quote'$(touch injected)", 'src/line\nbreak']) fs.mkdirSync(path.join(home, dir), {recursive:true});
    fs.writeFileSync(path.join(home, 'src/not-a-folder'), '');
    fs.symlinkSync(path.join(home, 'src/vendor'), path.join(home, 'src/link'), 'dir');
    executor = async (command, args, options) => {
      const result = child.spawnSync(command, args, {encoding:'utf8', timeout:options?.timeout});
      return {code:result.status ?? 1, stdout:result.stdout, stderr:result.stderr};
    };
    picker = make(); calls = [];
    picker.filter.set_value('~/sr');
    picker.pickerKey({keystroke:'tab'}, cx); // Tab while the listing is still pending.
    await drain(); assert.equal(picker.filter.value(), '~/src/');
    picker.filter.set_value('~/src/ven'); await drain();
    picker.completePath(cx); await drain(); assert.equal(picker.filter.value(), '~/src/vendor/');
    picker.filter.set_value('~/src/vendor/rp'); await drain();
    picker.completePath(cx); await drain(); assert.equal(picker.filter.value(), '~/src/vendor/repo/');
    let opened;
    picker.choosePath = value => { opened = value; };
    picker.filter.submit(); assert.equal(opened, '~/src/vendor/repo/');
    picker.directoryCache[home + '/prefix/'] = [home + '/prefix/source', home + '/prefix/sources'];
    picker.filter.set_value('~/prefix/so'); picker.completePath(cx);
    assert.equal(picker.filter.value(), '~/prefix/source'); assert.equal(picker.folderRows().length, 2);
    picker.filter.set_value('~/src/fa'); await drain();
    assert.equal(picker.folderRows().length, 2);
    const previous = picker.filter.value(); picker.completePath(cx); assert.equal(picker.filter.value(), previous);
    picker.pickerKey({keystroke:'down'}, cx); assert.equal(cx.stopped, true);
    picker.completePath(cx); await drain(); assert.equal(picker.filter.value(), '~/src/farm/');
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
    picker.pickerKey({keystroke:'down'}, cx); const first = picker.selectedChoice;
    picker.pickerKey({keystroke:'up'}, cx); assert.notEqual(picker.selectedChoice, first);
    picker.pickerKey({keystroke:'down'}, cx); assert.equal(picker.selectedChoice, first);
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
  picker.pickerKey({keystroke:'tab'}, cx);
  picker.filter.set_value('/new/b'); const newTask = tasks.shift()(cx);
  current.resolve({code:0, stdout:'/new/beta\0'}); await newTask;
  old.resolve({code:0, stdout:'/old/alpha\0'}); await oldTask;
  assert.equal(picker.filter.value(), '/new/b'); assert.deepEqual(plain(picker.folderRows()), ['/new/beta']);
  saved = [{machine:null, root:'/home/me/src/vendor/repo'}];
  const delayed = deferred(); executor = () => delayed.promise;
  picker = make(); picker.filter.set_value('~/sr'); const delayedTask = tasks.shift()(cx);
  picker.pickerKey({keystroke:'tab'}, cx); picker.pickerKey({keystroke:'down'}, cx);
  assert.equal(picker.completeRequested, null); assert.deepEqual(picker.choiceScroll.last, [0, 'center']);
  delayed.resolve({code:0, stdout:'/home/me/src\0'}); await delayedTask;
  assert.equal(picker.filter.value(), '~/sr');
  assert.deepEqual(picker.choiceScroll.last, [1, 'center']); // Preserve visibility when a directory is inserted before history.
  saved = [{machine:null, root:'/home/me/src'}];
  const duplicate = deferred(); executor = () => duplicate.promise;
  picker = make(); picker.filter.set_value('~/sr'); const duplicateTask = tasks.shift()(cx);
  picker.pickerKey({keystroke:'down'}, cx); const savedChoice = picker.selectedChoice;
  duplicate.resolve({code:0, stdout:'/home/me/src\0'}); await duplicateTask;
  assert.equal(picker.projectChoices().length, 1); assert.equal(picker.projectChoices()[0].id, savedChoice);
  let selectedPath; picker.choosePath = value => { selectedPath = value; };
  picker.filter.submit(); assert.equal(selectedPath, '/home/me/src');
  saved = [];
  const late = deferred(); executor = () => late.promise;
  picker = make(); picker.filter.set_value('/late/l'); const closingTask = tasks.shift()(cx);
  picker.close(); late.resolve({code:0, stdout:'/late/late\0'}); await closingTask;
  assert.equal(picker.directoryCache['/late/'], undefined);

  // Input cannot receive on_key_down. Virtual rows cannot register handlers during layout.
  let inLayout = false, list;
  const renderElement = () => {
    let proxy; const node = {events:{}};
    proxy = new Proxy(node, {get: (target, method) => method in target ? target[method] : (...args) => {
      if (method === 'when' && args[0]) args[1](proxy);
      if (method === 'track_focus') target.handle = args[0];
      if (method.startsWith('on_')) assert.equal(inLayout, false, 'Handlers are forbidden inside a virtual-list renderer');
      if (method === 'on_key_down') target.events.key = args[0];
      if (method === 'on_item_click') target.events.click = args[0];
      return proxy;
    }}); return proxy;
  };
  sandbox.div = sandbox.v_flex = renderElement; sandbox.theme = () => ({}); sandbox.Input = {new:renderElement};
  sandbox.v_virtual_list = (_id, count, _height, key, render) => {
    for (let i = 0; i < count; i++) assert.equal(typeof key(i), 'string');
    inLayout = true;
    try { render({start:0, end:count}, cx); } finally { inLayout = false; }
    list = renderElement(); return list;
  };
  sandbox.Scrollbar = {vertical:renderElement};
  saved = [{machine:null, root:'/home/me/src/vendor/repo'}];
  picker = make(); const root = picker.projectPicker();
  assert.equal(root.handle, picker.handle); assert.equal(typeof root.events.key, 'function');
  let clicked; picker.chooseProject = project => { clicked = project.root; };
  list.events.click(picker.projectChoices()[0].id, cx); assert.equal(clicked, saved[0].root);
  picker.filter.text = '~/src/'; picker.directoryCache['/home/me/src/'] = ['/home/me/src/vendor'];
  picker.projectPicker(); const id = picker.projectChoices()[0].id;
  picker.fillPath = value => { clicked = value; };
  list.events.click(id, cx); assert.equal(clicked, '/home/me/src/vendor');
  clicked = null; picker.directoryCache['/home/me/src/'] = []; picker.filter.text = 'nomatch';
  list.events.click(id, cx); assert.equal(clicked, null); // Ignore a click queued before filtering removed its key.
  console.log('project picker tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
