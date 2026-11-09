const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const child = require('node:child_process');
const os = require('node:os');
const pathModule = require('node:path');
const source = fs.readFileSync('config/herdr-app/mods/task-tree/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');
const logicSource = fs.readFileSync('config/herdr-app/mods/task-tree/doc-logic.js', 'utf8').replace(/^export /gm, '');
const { slugify, template } = vm.runInNewContext(logicSource + '\n({slugify, template})');
{
  const dir = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'artifact-test-'));
  try {
    const html = pathModule.join(dir, 'page with spaces.html'), capture = pathModule.join(dir, 'args.json');
    const fake = pathModule.join(dir, 'herdr-app');
    fs.writeFileSync(fake, '#!/bin/sh\nprintf "%s" "$2" > "$CAPTURE"\n'); fs.chmodSync(fake, 0o755);
    const run = (text, args = []) => {
      fs.writeFileSync(html, text);
      const result = child.spawnSync('bash', ['bin/herdr-artifact', 'add', html, ...args], {encoding:'utf8', env:{...process.env, HC_TERMINAL_ID:'t-test', PATH:dir + ':' + process.env.PATH, CAPTURE:capture}});
      assert.equal(result.status, 0, result.stderr);
      const command = fs.readFileSync(capture, 'utf8'); assert.ok(command.startsWith('task-tree.artifact:'));
      return JSON.parse(command.slice('task-tree.artifact:'.length));
    };
    assert.equal(run('<TITLE class="x">  Hello\n world </TITLE>').title, 'Hello world');
    assert.equal(run('<p>Untitled</p>').title, 'page with spaces.html');
    const custom = run('<title>Ignored</title>', ['--title', 'Quoted " title']);
    assert.equal(custom.title, 'Quoted " title'); assert.equal(custom.terminal, 't-test'); assert.equal(custom.path, fs.realpathSync(html));
    const noTerminal = child.spawnSync('bash', ['bin/herdr-artifact', 'add', '/missing'], {encoding:'utf8', env:{...process.env, HC_TERMINAL_ID:''}});
    assert.equal(noTerminal.status, 0); assert.match(noTerminal.stdout, /not registered/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
}
const artifactLogic = fs.readFileSync('config/herdr-app/mods/task-tree/artifact-logic.js', 'utf8').replace(/^export /gm, '');
const { artifactKey, addArtifact, seeArtifact, removeArtifact, artifactSpace, lavishUrl, openCommand, age } = vm.runInNewContext(artifactLogic + '\n({artifactKey, addArtifact, seeArtifact, removeArtifact, artifactSpace, lavishUrl, openCommand, age})');
let artifacts = addArtifact([], '/one.html', 'One', 100);
artifacts = addArtifact(artifacts, '/two.html', 'Two', 200);
artifacts = seeArtifact(artifacts, '/one.html', 100); assert.equal(artifacts[1].seen, true);
artifacts = addArtifact(artifacts, '/one.html', 'Again', 300);
assert.equal(artifacts.length, 2); assert.equal(artifacts[0].title, 'Again'); assert.equal(artifacts[0].added, 300); assert.equal(artifacts[0].seen, false);
artifacts = removeArtifact(artifacts, '/one.html'); assert.equal(artifacts.length, 1); assert.equal(artifacts[0].path, '/two.html');
assert.equal(artifactSpace('child', [{terminal:'parent',tab:'t'}], [{id:'s',tabs:[{id:'t'}]}], [{address:'child',parent:'parent'}]), 's');
assert.equal(artifactSpace('unknown', [], [], []), null);
const collisionSpaces = [{id:'sp1',machine:null,tabs:[]}, {id:'remote/sp1',machine:'remote',tabs:[{id:'remote/tb1'}]}];
assert.equal(artifactSpace('remote/t1', [], collisionSpaces, [{address:'remote/t1',labels:{'herdr.space':'sp1'}}]), null);
assert.equal(artifactSpace('remote/t1', [{terminal:'remote/t1',tab:'remote/tb1'}], collisionSpaces, []), null);
assert.equal(artifactSpace('t1', [], collisionSpaces, [{address:'t1',labels:{'herdr.space':'sp1'}}]), 'sp1');
assert.equal(lavishUrl('session:\n  url: "http://localhost/session/abc"\n'), 'http://localhost/session/abc');
assert.equal(lavishUrl('no url'), null);
assert.equal(JSON.stringify(openCommand('http://localhost/x', true)), JSON.stringify(['open',['-a','Lavish','http://localhost/x']]));
assert.equal(JSON.stringify(openCommand('http://localhost/x', false)), JSON.stringify(['open',['-na','Google Chrome','--args','--app=http://localhost/x']]));
assert.equal(age(0, 120000), '2m ago');
const docLogic = fs.readFileSync('config/herdr-app/mods/task-doc/doc-logic.js', 'utf8').replace(/^export /gm, '');
const { links, decision } = vm.runInNewContext(docLogic + '\n({links, decision})');
assert.equal(slugify('  Héllo, World! '), 'hello-world'); assert.equal(slugify('!!!'), 'task');
const doc = template('Example', '2026-01-02');
assert.match(doc, /\nowner: \n/);
assert.match(template('Example', '2026-01-02', 'example owner'), /\nowner: "example owner"\n/);
assert.match(doc, /status: Open\npriority:\nlabels: \[\]/); assert.match(doc, /created: 2026-01-02\nticket:\npr:/); assert.match(doc, /\n# Example\n/);
assert.equal(links('---\nticket: https://example.com/a\npr: "https://example.com/b"\n---\n').pr, 'https://example.com/b');
assert.equal(links('# Heading\nticket: https://example.com').ticket, undefined); assert.equal(links('---\nticket: javascript:bad\n---\n').ticket, undefined);
assert.equal(decision('a','a','a'), 'clean'); assert.equal(decision('a','a','b'), 'save'); assert.equal(decision('b','a','a'), 'reload'); assert.equal(decision('b','a','b'), 'reload'); assert.equal(decision('b','a','c'), 'banner'); assert.equal(decision(null,'a','b'), 'banner');
const store = {}, calls = [], queue = [], actions = [], notices = [], logs = [];
let visibleSpaces = [];
let ready = false, finishLookup;
const sandbox = {
  View: class {}, localStorage: {getItem: k => store[k] ?? null, setItem: (k,v) => { store[k] = v; }},
  machines: () => [{name:null,layout:ready ? 'ready' : 'loading'}], home: () => '/home/me',
  spaces: () => visibleSpaces, run: (command, args) => actions.push({command, args}),
  exec: (command,args,options) => { calls.push({command,args,options}); return new Promise(resolve => { finishLookup = resolve; }); },
  notify: notice => notices.push(notice), console: {log: text => logs.push(text)},
  panes: () => [], terminals: () => [], shared: () => ({}), artifactKey, addArtifact, artifactSpace,
  props: () => currentProps, closeOverlay: id => closedOverlays.push(id), setShared: (key, value) => sharedUpdates.push({key, value}),
};
let currentProps = {}, closedOverlays = [], sharedUpdates = [];
const { key, groupSpaces, step, nth, firstTerminal, taskAgent, taskTitle, history, repoRoot, movePin, TaskTree } = vm.runInNewContext(source + '\n({key, groupSpaces, step, nth, firstTerminal, taskAgent, taskTitle, history, repoRoot, movePin, TaskTree})', sandbox);
const spaces = [{id:'a',folder:'/stale',machine:null,tabs:[{id:'one'}]}, {id:'b',folder:'/other',machine:null,tabs:[]}, {id:'c',folder:'/stale',machine:null,tabs:[]}, {id:'d',folder:'/repo',machine:'remote',tabs:[]}];
const assignments = {a:{machine:null,root:'/repo'}, b:{machine:null,root:'/other'}, c:{machine:null,root:'/repo'}, d:{machine:'remote',root:'/repo'}};
const hist = history([{machine:null,root:'/other'}, {machine:null,root:'/repo'}, {machine:null,root:'/other'}], assignments);
assert.equal(hist.map(p => `${p.machine ?? 'local'}:${p.root}`).join(','), 'local:/other,local:/repo,remote:/repo');
assert.equal(repoRoot('/dir/sub', '/jj\n', '/git'), '/jj'); assert.equal(repoRoot('/dir/sub', '', '/git\n'), '/git'); assert.equal(repoRoot('/standalone', '', ''), '/standalone');
const moved = {a:{machine:null,root:'/old'}}; movePin(moved, 'a', {machine:'remote',root:'/new'}); assert.equal(moved.a.root, '/new'); assert.equal(moved.a.machine, 'remote');
const groups = groupSpaces(spaces, assignments);
assert.equal(groups.length, 3); assert.equal(groups[0].tasks.map(x => x.id).join(','), 'b');
assert.equal(groups[1].tasks.map(x => x.id).join(','), 'a,c'); assert.equal(groups[2].machine, 'remote');
const orderSpaces = [
  {id:'A1'}, {id:'B1'}, {id:'A2'}, {id:'D1'}, {id:'C1'},
];
const orderAssignments = {
  A1:{machine:'builder-z',root:'/work'}, B1:{machine:'builder-a',root:'/work'},
  A2:{machine:'builder-z',root:'/work'}, D1:{machine:'builder-z',root:'/archive'}, C1:{machine:null,root:'/work'},
};
const groupKey = group => `${group.machine ?? 'local'}:${group.root}`;
const interleavedGroups = groupSpaces(orderSpaces, orderAssignments);
assert.deepEqual(Array.from(interleavedGroups, groupKey), ['local:/work','builder-a:/work','builder-z:/archive','builder-z:/work']);
assert.deepEqual(Array.from(interleavedGroups[3].tasks, task => task.id), ['A1','A2'], 'same-group tasks keep live interleaved order');
const shuffledGroups = groupSpaces([orderSpaces[4],orderSpaces[3],orderSpaces[2],orderSpaces[1],orderSpaces[0]], orderAssignments);
assert.deepEqual(Array.from(shuffledGroups, groupKey), Array.from(interleavedGroups, groupKey), 'group order is deterministic when live spaces are shuffled');
assert.deepEqual(Array.from(shuffledGroups[3].tasks, task => task.id), ['A2','A1'], 'task order still follows live-space order');
const afterRemovingA1 = groupSpaces(orderSpaces.filter(space => space.id !== 'A1'), orderAssignments);
assert.deepEqual(Array.from(afterRemovingA1, groupKey), Array.from(interleavedGroups, groupKey), 'closing a project\'s first task does not move its surviving group');
assert.deepEqual(Array.from(afterRemovingA1.find(group => groupKey(group) === 'builder-z:/work').tasks, task => task.id), ['A2']);
const survivingOrder = Array.from(interleavedGroups).filter(group => !group.tasks.some(task => task.id === 'B1')).map(groupKey);
const afterRemovingB1 = groupSpaces(orderSpaces.filter(space => space.id !== 'B1'), orderAssignments);
assert.deepEqual(Array.from(afterRemovingB1, groupKey), survivingOrder, 'removing interleaved B1 keeps the remaining group order stable');
assert.deepEqual(Array.from(afterRemovingB1.find(group => groupKey(group) === 'builder-z:/work').tasks, task => task.id), ['A1','A2']);
{
  const rendered = [];
  const element = () => {
    const node = new Proxy({}, {get: (_target, method) => (...args) => {
      if (method === 'child' && typeof args[0] === 'string') rendered.push(args[0]);
      if (method === 'when' && args[0]) args[1](node);
      return node;
    }});
    return node;
  };
  sandbox.div = sandbox.h_flex = sandbox.v_flex = element;
  const tree = new TaskTree(); tree.folded = {}; tree.hoveredProject = null;
  tree.project({...groups[0], root:'/MixedCase', tasks:[]}, [], {}, {});
  assert.ok(rendered.includes('MixedCase'));
  rendered.length = 0;
  tree.project({...groups[2], root:'/MixedCase', machine:'build-host', tasks:[]}, [], {}, {});
  assert.ok(rendered.includes('build-host: MixedCase'));
}
const ordered = groups.flatMap(g => g.tasks);
assert.equal(step(ordered, 'c', 1).id, 'd'); assert.equal(step(ordered, 'a', -1).id, 'b');
assert.equal(step([], null, 1), null); assert.equal(nth(groups[1].tasks, 2).id, 'c'); assert.equal(nth(groups, 0), null);
assert.equal(step(groups, groups[0].id, -1).id, groups[2].id);
const reporting = {space:'a',title:'Agent session',program:{agent:false}};
assert.equal(taskTitle(spaces[0], taskAgent(spaces[0], [reporting])), 'Agent session');
assert.equal(taskTitle({...spaces[0],named:true,name:'Explicit'}, reporting), 'Explicit');
assert.equal(taskTitle({...spaces[0],name:'Fallback'}, null), 'Fallback');
assert.equal(firstTerminal(spaces[0], [{tab:'one',terminal:'t1',cwd:'/live/sub'}]).cwd, '/live/sub');
async function testArtifactsPanel() {
  const code = fs.readFileSync('config/herdr-app/mods/task-artifacts/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');
  const saved = {s:[{path:'/test.html',title:'Test',added:1,seen:false}]}, calls = [], queue = [], closed = [], keyBindings = [], scrollCalls = [], rendered = [], renderedText = [];
  let fail = false, gate = null, release, notifies = 0, stopped = 0, focusCalls = 0, inVirtualList = false, activeProps = {space:'s',overlay:'picker'};
  class TestInputState {
    constructor(options) { this.options = options; this.text = options.value ?? ''; this.handlers = {}; }
    static new(options) { return new TestInputState(options); }
    on(name, callback) { this.handlers[name] = callback; }
    value() { return this.text; }
    setValue(value, cx) { this.text = value; this.handlers.change?.(null, cx); }
    submit(cx) { this.handlers.submit?.(null, cx); }
    focus() { focusCalls++; }
    release() { this.released = true; }
  }
  const element = (kind = 'element') => {
    const target = {kind,elementId:null,nodes:[],events:{},calls:[]};
    const node = new Proxy(target, {get(obj, method) {
      if (method === 'child') return child => { obj.nodes.push(child); if (typeof child === 'string') renderedText.push(child); return node; };
      if (method === 'children') return children => { obj.nodes.push(...children); return node; };
      if (method === 'when') return (condition, fn) => { if (condition) fn(node); return node; };
      if (method === 'id') return id => { obj.elementId = id; return node; };
      if (method === 'tooltip') return text => { obj.tip = text; return node; };
      if (method in obj) return obj[method];
      if (method === 'on_action') return (name, fn) => { assert.equal(inVirtualList, false, 'handlers are forbidden inside a virtual-list renderer'); obj.events[`action:${name}`] = fn; return node; };
      if (typeof method === 'string' && method.startsWith('on_')) return (...args) => { assert.equal(inVirtualList, false, 'handlers are forbidden inside a virtual-list renderer'); obj.events[method] = args.at(-1); return node; };
      return (...args) => { obj.calls.push([method, ...args]); return node; };
    }});
    rendered.push(node); return node;
  };
  const sandbox = {View:class {}, artifactKey, seeArtifact, removeArtifact, lavishUrl, openCommand, age,
    InputState:TestInputState, Input:{new:() => element('input')}, VirtualListScrollHandle:{new:() => ({scroll_to_item:index => scrollCalls.push(index)})},
    Scrollbar:{vertical:() => element('scrollbar')}, div:() => element('div'), h_flex:() => element('h_flex'), v_flex:() => element('v_flex'),
    v_virtual_list:(name,count,_height,key,renderRows) => {
      const list = element('virtual-list'); list.listName = name; list.count = count; list.keys = Array.from({length:count},(_,i) => key(i));
      let rows; inVirtualList = true; try { rows = renderRows({start:0,end:count}); } finally { inVirtualList = false; }
      list.children(rows); return list;
    },
    theme:() => ({popover:'popover',foreground:'foreground',muted:'muted',dim:'dim',selected:'selected',hover:'hover',accent:'accent',blocked:'blocked',input:'input',background:'background'}),
    shared:() => saved, setShared:(_key,value) => Object.assign(saved,value), home:() => '/home/me', props:() => activeProps,
    spaces:() => [{id:'s',active:true}],
    closeOverlay:id => closed.push(id),
    exec: async (cmd,args) => {
      calls.push([cmd,args]);
      if (cmd === 'lavish-axi') {
        if (gate) await gate;
        if (fail) return {code:1,stderr:'failed'};
        return args.includes('--reopen')
          ? {code:0,stdout:'session:\n  url: "http://localhost/session/live"\n  status: opened\n'}
          : {code:0,stdout:'session:\n  url: "http://localhost/session/dead"\n  status: user-ended\n'};
      }
      return {code:cmd === 'test' ? 1 : 0};
    }};
  const {TaskArtifacts} = vm.runInNewContext(code + '\n({TaskArtifacts})', sandbox);
  const cx = {spawn:fn => queue.push(fn), notify(){notifies++;}, focus_handle:() => ({focus(){}}), bind_keys:keys => keyBindings.push(keys), stop_propagation(){stopped++;}};
  const drainQueue = async (limit = 50) => {
    let drained = 0;
    while (queue.length) { assert.ok(drained < limit, 'queued render work must settle without an endless notify loop'); await queue.shift()(cx); drained++; }
    return drained;
  };
  const renderAndDrain = async () => { panel.render(cx); await drainQueue(); };
  const panel = new TaskArtifacts(); panel.init(null,cx);
  assert.equal(panel.space, 's'); assert.equal(focusCalls, 1);
  assert.equal(keyBindings[0].map(({keystroke,action}) => `${keystroke}:${action}`).join(','), 'tab:task-artifact-next,shift-tab:task-artifact-prev,down:task-artifact-next,up:task-artifact-prev,escape:task-artifact-close');
  assert.equal(panel.selection(panel.items()).path, '/test.html', 'the first result is selected by default');

  saved.s = [
    {path:'/reports/overview.html',title:'Report Overview',added:400,seen:false},
    {path:'/overview/report.html',title:'Overview Report',added:200,seen:false},
    {path:'/archive/REPORT.html',title:'Quarterly Summary',added:300,seen:true},
    {path:'/nested/data/alpha.html',title:'Alpha Guide',added:500,seen:false},
  ];
  panel.filter.setValue('over',cx);
  assert.deepEqual(panel.items().map(item => item.path), ['/overview/report.html','/reports/overview.html'], 'prefix matches rank ahead of substring matches');
  assert.equal(panel.selection(panel.items()).path, '/overview/report.html');
  panel.filter.setValue('REPORT',cx);
  assert.deepEqual(panel.items().map(item => item.path), ['/reports/overview.html','/archive/REPORT.html','/overview/report.html'], 'matching is case-insensitive and ranks title/path fuzzy matches');
  panel.filter.setValue('nested/data',cx);
  assert.deepEqual(panel.items().map(item => item.title), ['Alpha Guide'], 'the path participates in matching');
  panel.filter.setValue('zz-not-found',cx);
  assert.equal(panel.items().length, 0);
  rendered.length = 0; renderedText.length = 0;
  await renderAndDrain();
  assert.ok(renderedText.includes('No matching artifacts'), 'the no-match render shows the empty-state message');
  panel.filter.setValue('over',cx);
  panel.action('task-artifact-next',cx);
  assert.equal(panel.selected, '/reports/overview.html');
  const scrollBeforeReset = scrollCalls.length;
  panel.filter.setValue('REPORT',cx);
  assert.equal(panel.selected, null, 'changing the query resets selection');
  assert.equal(scrollCalls.length, scrollBeforeReset + 1); assert.equal(scrollCalls.at(-1), 0, 'changing the query resets scroll to the first result');
  assert.equal(panel.selection(panel.items()).path, '/reports/overview.html', 'query reset returns selection to the new first result');

  panel.filter.setValue('over',cx); panel.selected = null;
  rendered.length = 0;
  await renderAndDrain();
  let root = rendered.find(node => node.elementId === 'artifact-picker');
  const focusBeforeActions = focusCalls;
  root.events['action:task-artifact-next'](null,cx);
  assert.equal(panel.selected, '/reports/overview.html'); assert.equal(scrollCalls.at(-1), 1); assert.equal(focusCalls, focusBeforeActions + 1);
  root.events['action:task-artifact-prev'](null,cx);
  assert.equal(panel.selected, '/overview/report.html'); assert.equal(scrollCalls.at(-1), 0); assert.equal(focusCalls, focusBeforeActions + 2);
  assert.ok(notifies >= 2); assert.ok(stopped >= 2, 'navigation actions stop propagation');

  const reconcilePath = '/selected.html';
  saved.s = [
    {path:'/newest.html',title:'Newest',added:300,seen:false},
    {path:reconcilePath,title:'Selected',added:200,seen:false},
    {path:'/oldest.html',title:'Oldest',added:100,seen:false},
  ];
  panel.filter.setValue('',cx); panel.selected = reconcilePath; scrollCalls.length = 0;
  let reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.deepEqual(scrollCalls, [1], 'render reconciliation scrolls to the selected artifact index');
  assert.equal(notifies, reconcileNotifies + 1);
  reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.equal(queue.length, 0); assert.equal(notifies, reconcileNotifies, 'a stable render does not schedule another notify');

  saved.s = addArtifact(saved.s, reconcilePath, 'Selected moved to front', 400);
  assert.equal(panel.items()[0].path, reconcilePath);
  scrollCalls.length = 0; reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.deepEqual(scrollCalls, [0], 'external re-registration/reordering scrolls the selected artifact back into view');
  assert.equal(notifies, reconcileNotifies + 1);

  saved.s = removeArtifact(saved.s, reconcilePath);
  const fallbackPath = panel.items()[0].path;
  scrollCalls.length = 0; reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.equal(panel.selection(panel.items()).path, fallbackPath, 'removing the selected artifact falls back to the first remaining result');
  assert.deepEqual(scrollCalls, [0], 'external removal reconciles scroll to the fallback selection');
  assert.equal(notifies, reconcileNotifies + 1);

  saved.s = addArtifact(saved.s, reconcilePath, 'Selected re-registered', 250);
  saved.s = [saved.s[1], saved.s[0], ...saved.s.slice(2)];
  assert.equal(panel.selection(panel.items()).path, reconcilePath); assert.equal(panel.items().indexOf(panel.selection(panel.items())), 1);
  scrollCalls.length = 0; reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.deepEqual(scrollCalls, [1], 're-registration at a new index reconciles scroll');
  assert.equal(notifies, reconcileNotifies + 1);

  saved.s = removeArtifact(saved.s, reconcilePath);
  rendered.length = 0; panel.render(cx); assert.equal(queue.length, 1, 'removal queues a fallback reconciliation');
  saved.s = addArtifact(saved.s, reconcilePath, 'Selected restored before scroll', 250);
  saved.s = [saved.s[1], saved.s[0], ...saved.s.slice(2)];
  rendered.length = 0; panel.render(cx); assert.equal(queue.length, 2, 're-registration queues a newer reconciliation');
  assert.equal(panel.selection(panel.items()).path, reconcilePath);
  scrollCalls.length = 0; reconcileNotifies = notifies;
  assert.equal(await drainQueue(), 2);
  assert.deepEqual(scrollCalls, [1], 'a stale removal job cannot scroll away from the re-registered selection');
  assert.equal(notifies, reconcileNotifies + 1, 'only the current reconciliation notifies');
  reconcileNotifies = notifies; rendered.length = 0; await renderAndDrain();
  assert.equal(queue.length, 0); assert.equal(notifies, reconcileNotifies, 'the post-notify render does not start an infinite reconciliation loop');

  panel.filter.setValue('',cx); saved.s = [{path:'/test.html',title:'Test',added:1,seen:false}];
  panel.open('s', saved.s[0], cx); await queue.shift()(cx);
  assert.equal(saved.s[0].seen, true); assert.equal(calls[0][0], 'lavish-axi'); assert.equal(calls[2][0], 'open');
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify(['/test.html','--reopen','--no-open']));
  assert.equal(JSON.stringify(calls[2][1]), JSON.stringify(['-na','Google Chrome','--args','--app=http://localhost/session/live']));
  assert.deepEqual(closed, ['picker'], 'the overlay closes after a successful open');
  saved.s[0].seen = false; fail = true; panel.open('s', saved.s[0], cx); await queue.shift()(cx);
  assert.equal(saved.s[0].seen, false); assert.match(panel.error, /failed/); assert.equal(calls.length, 4);
  assert.deepEqual(closed, ['picker'], 'a failed open leaves the overlay open');
  fail = false; gate = new Promise(resolve => { release = resolve; });
  const clicked = saved.s[0]; panel.open('s', clicked, cx); const opening = queue.shift()(cx);
  panel.open('s', clicked, cx); assert.equal(queue.length, 0, 'duplicate opens are ignored while an artifact is opening');
  saved.s = addArtifact(saved.s, clicked.path, 'Re-registered', clicked.added);
  assert.ok(saved.s[0].added > clicked.added); release(); await opening;
  assert.equal(saved.s[0].title, 'Re-registered'); assert.equal(saved.s[0].seen, false);
  assert.deepEqual(closed, ['picker','picker']);

  saved.s = [
    {path:'/reports/overview.html',title:'Report Overview',added:400,seen:false},
    {path:'/overview/report.html',title:'Overview Report',added:200,seen:false},
    {path:'/archive/REPORT.html',title:'Quarterly Summary',added:300,seen:true},
  ];
  panel.filter.setValue('over',cx); panel.selected = '/overview/report.html';
  const selectedPath = panel.selection(panel.items()).path, opensBeforeSubmit = calls.filter(([cmd]) => cmd === 'lavish-axi').length;
  panel.filter.submit(cx); assert.equal(panel.opening, selectedPath); await queue.shift()(cx);
  assert.equal(calls.filter(([cmd]) => cmd === 'lavish-axi').at(-1)[1][0], selectedPath, 'Enter opens the selected result');
  panel.selected = selectedPath; rendered.length = 0; await renderAndDrain();
  const list = rendered.find(node => node.kind === 'virtual-list' && node.listName === 'artifact-choices');
  list.events.on_item_click(selectedPath,cx); assert.equal(panel.opening, selectedPath); await queue.shift()(cx);
  assert.equal(calls.filter(([cmd]) => cmd === 'lavish-axi').length, opensBeforeSubmit + 2);
  assert.deepEqual(calls.filter(([cmd]) => cmd === 'lavish-axi').slice(-2).map(([,args]) => args[0]), [selectedPath,selectedPath], 'Enter and row click open the same selected result');

  rendered.length = 0; await renderAndDrain();
  const remove = rendered.find(node => node.elementId === 'artifact-remove'), opensBeforeRemove = calls.length, closesBeforeRemove = closed.length;
  assert.ok(remove, 'the selected result has a footer remove button');
  remove.events.on_click(null,cx);
  assert.equal(saved.s.some(item => item.path === selectedPath), false); assert.equal(panel.selected, null); assert.equal(scrollCalls.at(-1), 0);
  assert.equal(calls.length, opensBeforeRemove); assert.equal(queue.length, 0);
  assert.equal(closed.length, closesBeforeRemove, 'removing an item does not open an artifact or close the dialog');
  root = rendered.find(node => node.elementId === 'artifact-picker'); root.events['action:task-artifact-close'](null,cx);
  assert.equal(closed.at(-1), 'picker', 'Escape action closes the overlay'); assert.ok(stopped >= 5);
  panel.close(); assert.equal(panel.filter.released, true);
  activeProps = null;
  const fallback = new TaskArtifacts(); fallback.init(null,cx);
  assert.equal(fallback.space, 's', 'standalone checks without props use the active space');
  fallback.render(cx); await drainQueue(); fallback.close();
}
async function testEditor() {
  const code = fs.readFileSync('config/herdr-app/mods/task-doc/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');
  const storage = {}, writes = [], tasks = [];
  const localStorage = { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; }, removeItem: key => { delete storage[key]; }, flush: async () => {} };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise, resolve}; };
  const cx = {notify(){}, spawn: fn => tasks.push(fn), timer:{every(){}}};
  let path = '/notes/test.md', disk = 'A', writeGate = null, readGate = null;
  const sandbox = { View: class {}, props: () => ({path}), settings: () => ({}), localStorage, links, decision,
    readTextFile: async () => { if (readGate) await readGate.promise; return disk; },
    writeTextFile: async (p,text,expected) => { writes.push({p,text,expected}); if (writeGate) await writeGate.promise; if (disk !== expected) throw new Error('stale'); disk = text; },
    EditorState: {new: () => ({text:'', on(_event, fn) { this.change=fn; }, value() { return this.text; }, set_value(text) { this.text=text; this.change(null,cx); }, release() { this.released=true; }})},
    notify(){}, watchFolder(){}, nextCommand(){} };
  const {TaskDoc} = vm.runInNewContext(code + '\ncheckPath = async () => {}; ({TaskDoc})', sandbox);
  const tick = async () => { for (let i=0; i<8; i++) await Promise.resolve(); };
  const recovered = () => JSON.parse(storage['recovery2:'+path]);
  const run = async () => { const task = tasks.shift(); assert.ok(task); await task(cx); };
  const make = async () => { const mod = new TaskDoc(); mod.init(null,cx); await run(); tasks.length=0; return mod; };
  const setRecovery = (text, base) => { storage['recovery2:'+path] = JSON.stringify({v:2,text,base}); };
  let mod = await make();
  mod.editor.set_value('C'); assert.equal(recovered().base, 'A'); mod.save(cx); await run();
  assert.equal(disk, 'C'); assert.equal(mod.base, 'C'); assert.equal(storage['recovery2:'+path], undefined);
  disk = 'B'; mod.refresh(cx); await run(); assert.equal(mod.editor.value(), 'B'); assert.equal(mod.base, 'B');
  mod.editor.set_value('C'); disk = 'external'; mod.save(cx); await run(); assert.equal(disk, 'external'); assert.equal(mod.conflict, true);
  mod.reload(cx); await run(); assert.equal(mod.editor.value(), 'external'); assert.equal(mod.base, 'external'); assert.equal(storage['recovery2:'+path], undefined);
  mod.editor.set_value('mine'); disk = 'new external'; mod.save(cx); await run(); assert.equal(mod.conflict, true);
  mod.save(cx, true); await run(); assert.equal(writes.at(-1).expected, 'new external'); assert.equal(disk, 'mine'); assert.equal(mod.base, 'mine');
  mod.editor.set_value('new mine'); disk = 'first external'; writeGate = deferred(); mod.save(cx, true); const racingKeep = tasks.shift()(cx); await tick();
  assert.equal(writes.at(-1).expected, 'first external'); disk = 'second external'; writeGate.resolve(); writeGate = null; await racingKeep;
  assert.equal(disk, 'second external'); assert.equal(mod.conflict, true); assert.equal(recovered().base, 'mine');
  mod.reload(cx); await run();
  // Recovered edits retain their original base through close, later typing, and another restore.
  disk = 'B'; setRecovery('C', 'A'); mod = await make(); mod.restore(cx); await mod.close();
  assert.equal(disk, 'B'); assert.equal(mod.conflict, true); assert.equal(writes.at(-1).expected, 'A'); assert.equal(recovered().base, 'A');
  disk = 'B'; setRecovery('C', 'A'); mod = await make(); mod.restore(cx); mod.editor.set_value('D'); assert.equal(recovered().base, 'A');
  mod = await make(); mod.restore(cx); mod.save(cx); await run(); assert.equal(disk, 'B'); assert.equal(mod.conflict, true); assert.equal(writes.at(-1).expected, 'A');
  mod.save(cx, true); await run(); assert.equal(disk, 'D'); assert.equal(storage['recovery2:'+path], undefined);
  disk = 'B'; storage['recovery:'+path] = 'legacy text'; mod = await make(); mod.restore(cx); await mod.close();
  assert.equal(disk, 'B'); assert.equal(mod.conflict, true); assert.equal(recovered().text, 'legacy text');
  mod = await make(); mod.restore(cx); mod.save(cx, true); await run(); assert.equal(disk, 'legacy text');
  // Old values are always opaque, even when they resemble the structured format.
  const legacyJson = '{"text":"C","base":"B"}', oldKey = 'recovery:'+path, newKey = 'recovery2:'+path;
  disk = 'B'; storage[oldKey] = legacyJson; mod = await make(); assert.equal(mod.recovery.text, legacyJson);
  const setItem = localStorage.setItem; localStorage.setItem = () => { throw new Error('storage failed'); };
  assert.throws(() => mod.restore(cx), /storage failed/); assert.equal(storage[oldKey], legacyJson); assert.equal(mod.recovery.text, legacyJson);
  localStorage.setItem = setItem; mod.restore(cx); assert.equal(mod.editor.value(), legacyJson); assert.equal(storage[oldKey], undefined);
  assert.equal(recovered().v, 2); assert.equal(recovered().text, legacyJson); assert.equal(recovered().base.unknown, true);
  const beforeLegacyWrite = writes.length; mod.save(cx); await run(); assert.equal(writes.length, beforeLegacyWrite); assert.equal(disk, 'B'); assert.equal(mod.conflict, true);
  await mod.close(); assert.equal(writes.length, beforeLegacyWrite); assert.equal(disk, 'B');
  mod = await make(); mod.restore(cx); assert.equal(mod.editor.value(), legacyJson); mod.save(cx, true); await run(); assert.equal(disk, legacyJson);
  // If both keys exist, the new entry wins; discarding removes both.
  storage[oldKey] = 'older'; setRecovery('newer', 'A'); mod = await make(); assert.equal(mod.recovery.text, 'newer'); mod.discard(cx);
  assert.equal(storage[oldKey], undefined); assert.equal(storage[newKey], undefined);
  // Close waits for the older save, then writes the latest buffer against its new base.
  disk = 'A'; mod = await make(); mod.editor.set_value('C'); writeGate = deferred(); mod.save(cx); const saving = tasks.shift()(cx); await tick();
  mod.editor.set_value('D'); const closing = mod.close(); await tick(); assert.equal(writes.at(-1).text, 'C');
  writeGate.resolve(); writeGate = null; await saving; await closing; assert.equal(disk, 'D'); assert.equal(writes.at(-1).expected, 'C'); assert.equal(storage['recovery2:'+path], undefined);
  // An asynchronous reload must not discard edits made while it reads.
  disk = 'A'; mod = await make(); mod.editor.set_value('C'); readGate = deferred(); mod.reload(cx); const loading = tasks.shift()(cx); await tick();
  mod.editor.set_value('D'); readGate.resolve(); readGate = null; await loading; assert.equal(mod.editor.value(), 'D'); assert.equal(recovered().base, 'A'); assert.equal(mod.conflict, true);
  await mod.close(); assert.equal(disk, 'D');
  disk = 'A'; mod = await make(); mod.editor.set_value('C'); readGate = deferred(); mod.refresh(cx); const refreshing = tasks.shift()(cx); await tick();
  await mod.close(); assert.equal(disk, 'C'); readGate.resolve(); readGate = null; await refreshing; assert.equal(mod.editor.value(), 'C');
  disk = 'A'; setRecovery('C', 'A'); mod = await make(); mod.restore(cx); mod.save(cx); await run(); assert.equal(disk, 'C'); assert.equal(storage['recovery2:'+path], undefined);
  path = ''; const invalid = new TaskDoc(); invalid.init(null,cx); assert.equal(invalid.error, 'Invalid document path'); assert.equal(tasks.length, 0);
}
(async () => {
  const tree = new TaskTree(); Object.assign(tree, {assignments:{},roots:{},pending:{},folded:{},last:{}});
  const cx = {spawn: fn => queue.push(fn), notify(){}};
  tree.command('artifact:' + JSON.stringify({terminal:'remote/t1',path:'/test.html',title:'Remote'}), cx);
  assert.equal(sharedUpdates.length, 0); assert.equal(notices.length, 0); assert.equal(logs.length, 1);
  tree.command('artifact:not-json', cx); assert.equal(notices.length, 0); assert.equal(logs.length, 2);
  tree.resolve([spaces[0]], [{tab:'one',terminal:'t1',cwd:'/live/sub'}], cx);
  assert.equal(queue.length, 0); ready = true;
  tree.resolve([spaces[0]], [], cx); assert.equal(queue.length, 0);
  tree.resolve([spaces[0]], [{tab:'one',terminal:'t1',cwd:'/live/sub'}], cx);
  const pending = queue.shift()(cx);
  assert.equal(calls[0].options.cwd, '/live/sub'); assert.equal(store.assignments, undefined);
  finishLookup({code:0,stdout:'/live\n'}); await pending;
  assert.equal(JSON.parse(store.assignments).a.root, '/live');
  tree.resolve([spaces[0]], [{tab:'one',terminal:'t1',cwd:'/different'}], cx);
  assert.equal(queue.length, 0); assert.equal(tree.assignments.a.root, '/live');
  tree.savePin('a', {machine:null,root:'/replacement'}); assert.equal(tree.assignments.a.root, '/live');
  tree.savePin('created', {machine:null,root:'/chosen'}); assert.equal(tree.assignments.created.root, '/chosen');
  const fallback = {...spaces[0],id:'fallback'};
  tree.resolve([fallback], [{tab:'one',terminal:'t1',cwd:null}], cx);
  const pendingFallback = queue.shift()(cx); assert.equal(calls[1].options.cwd, '/stale');
  finishLookup({code:0,stdout:'/stored-root\n'}); await pendingFallback;
  assert.equal(tree.assignments.fallback.root, '/stored-root');
  const modOnly = {id:'mod-only',folder:'/repo/sub',machine:null,tabs:[{id:'review',panes:2}]};
  const modPanes = [{tab:'review',terminal:null,mod:'task-doc'}, {tab:'review',terminal:null,mod:'other'}];
  ready = false; tree.resolve([modOnly], modPanes, cx); assert.equal(queue.length, 0);
  ready = true; tree.resolve([modOnly], modPanes.slice(0, 1), cx); assert.equal(queue.length, 0);
  tree.resolve([modOnly], modPanes, cx); const modLookup = queue.shift()(cx);
  assert.equal(calls[2].options.cwd, '/repo/sub'); assert.equal(tree.assignments['mod-only'], undefined);
  finishLookup({code:0,stdout:'/repo\n'}); await modLookup;
  assert.equal(tree.assignments['mod-only'].root, '/repo');
  assert.equal(groupSpaces([modOnly], tree.assignments)[0].tasks[0].id, 'mod-only');
  visibleSpaces = [{...spaces[0],active:true}];
  const group = tree.groups()[0], before = calls.length;
  tree.command('new', cx); tree.newTask(group, cx);
  assert.equal(queue.length, 1); tree.resolve([fallback], [], cx); assert.equal(queue.length, 1);
  const creating = queue.shift()(cx); assert.equal(calls.length, before + 1);
  assert.equal(calls[before].command, 'herdr-app');
  assert.equal(calls[before].args[0], 'do'); assert.equal(calls[before].args[1], 'space.new');
  assert.deepEqual(JSON.parse(calls[before].args[2]), {folder:'/live',machine:''});
  finishLookup({code:0,stdout:'{"space":"new-space"}'}); await creating;
  assert.equal(tree.assignments['new-space'].root, '/live');
  assert.equal(JSON.parse(store.assignments)['new-space'].root, '/live');
  assert.equal(actions[0].command, 'space.select'); assert.equal(actions[0].args.id, 'new-space');
  assert.equal(tree.folded[group.id], false); assert.equal(tree.last[group.id], 'new-space');
  tree.newTask(group, cx); const failed = queue.shift()(cx);
  finishLookup({code:1,stderr:'failed'}); await failed;
  assert.equal(notices.length, 1); assert.equal(tree.creating, false);
  ready = false; tree.newTask(group, cx); assert.equal(queue.length, 0);
  currentProps = {task:'a',overlay:'picker'};
  const picker = new TaskTree(), beforeMove = calls.length;
  picker.chooseProject({machine:'remote',root:'/destination'}, cx); picker.chooseProject({machine:null,root:'/duplicate'}, cx);
  assert.equal(queue.length, 1); await queue.shift()(cx);
  assert.equal(calls.length, beforeMove); assert.equal(JSON.parse(store.assignments).a.root, '/destination');
  assert.equal(JSON.parse(store.assignments).fallback.root, '/stored-root');
  assert.equal(JSON.parse(store['project-history'])[0].root, '/destination');
  assert.ok(JSON.parse(store['project-history']).some(p => p.root === '/live'));
  assert.equal(closedOverlays.pop(), 'picker'); assert.equal(sharedUpdates.pop().key, 'task-project-update');
  tree.savePin('a', {machine:null,root:'/stale-lookup'}); assert.equal(tree.assignments.a.root, '/destination');
  for (let i=0; i<60; i++) { const next = new TaskTree(); next.chooseProject({machine:null,root:`/pin-${i}`}, cx); await queue.shift()(cx); }
  const pinHistory = JSON.parse(store['project-history']);
  for (let i=0; i<60; i++) assert.ok(pinHistory.some(p => p.root === `/pin-${i}`));
  currentProps = {overlay:'picker'};
  const dismissed = new TaskTree(); dismissed.choosePath('/tmp/cancelled', cx);
  const lookup = queue.shift()(cx); dismissed.close(); finishLookup({code:0});
  for (let i=0; i<5; i++) await Promise.resolve();
  finishLookup({code:0,stdout:'/tmp/cancelled'}); await lookup;
  assert.equal(queue.length, 0); assert.equal(calls.filter(c => c.command === 'herdr-app').length, 2);
  const opener = new TaskTree(); opener.chooseProject({machine:null,root:'/chosen'}, cx); opener.chooseProject({machine:null,root:'/chosen'}, cx);
  assert.equal(queue.length, 1); const opening = queue.shift()(cx);
  assert.deepEqual(JSON.parse(calls.at(-1).args[2]), {folder:'/chosen',machine:''});
  finishLookup({code:0,stdout:'{"space":"opened"}'}); await opening;
  assert.equal(JSON.parse(store.assignments).opened.root, '/chosen'); assert.equal(actions.at(-1).args.id, 'opened');
  const mode = vm.runInNewContext(source + '\n({docsKey, linkKey, docsDir, allowedDoc})', {...sandbox});
  assert.equal(mode.docsKey, 'docs'); assert.equal(mode.linkKey, 'task-doc-link');
  assert.equal(mode.docsDir(), '/home/me/mydesk/tasks');
  assert.equal(mode.allowedDoc(''), false); assert.equal(mode.allowedDoc('/notes.md'), true);
  await testEditor(); await testArtifactsPanel();
  if (process.argv.includes('--native')) {
    const mod = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'herdr-artifacts-check-'));
    try {
      const directory = 'config/herdr-app/mods/task-artifacts', logicDirectory = 'config/herdr-app/mods/task-tree';
      let nativeSource = fs.readFileSync(pathModule.join(directory, 'main.js'), 'utf8');
      nativeSource = nativeSource
        .replaceAll('props()', '({space:"native-artifact-space",overlay:"native-artifact-picker"})')
        .replaceAll('shared(artifactKey)', '({"native-artifact-space":[{path:"/tmp/native-artifact.html",title:"Native artifact",added:1,seen:false}]})');
      assert.ok(nativeSource.includes('Native artifact'), 'native check includes representative artifact data');
      fs.writeFileSync(pathModule.join(mod, 'main.js'), nativeSource);
      fs.copyFileSync(pathModule.join(directory, 'mod.json'), pathModule.join(mod, 'mod.json'));
      fs.copyFileSync(pathModule.join(logicDirectory, 'artifact-logic.js'), pathModule.join(mod, 'artifact-logic.js'));
      const result = child.spawnSync('herdr-app', ['check', mod], {encoding:'utf8', timeout:30000});
      assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
      console.log('native artifact modal check passed');
    } finally { fs.rmSync(mod, {recursive:true, force:true}); }
  }
  console.log('task-tree, task-doc and artifacts tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
