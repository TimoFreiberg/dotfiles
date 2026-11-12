const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const child = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const modPath = 'config/herdr-app/mods/task-tree';
const original = fs.readFileSync(`${modPath}/main.js`, 'utf8');
const source = original.replace(/^import .*;\n/gm, '').replace('export default class', 'class');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(initial = {}) {
  const store = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  let currentStore = store;
  const withStore = (storage, fn) => { const previous = currentStore; currentStore = storage; try { return fn(); } finally { currentStore = previous; } };
  const state = {spaces:[], machines:[{name:null, layout:'ready'}], props:{header:true}, calls:[], actions:[], overlays:[], closed:[], shared:{}, updates:0, nodes:[], queue:[], notices:[], stopped:0};
  function element() {
    const obj = {nodes:[], events:{}, styles:[]};
    const node = new Proxy(obj, {get(target, method) {
      if (method in target) return target[method];
      if (method === 'id') return id => { obj.id = id; return node; };
      if (method === 'child') return value => { obj.nodes.push(value); return node; };
      if (method === 'children') return values => { obj.nodes.push(...values); return node; };
      if (method === 'when') return (condition, fn) => { if (condition) fn(node); return node; };
      if (method === 'tooltip') return text => { obj.tip = text; return node; };
      if (method === 'on_mouse_down') return (button, fn) => { obj.events[`mouse:${button}`] = fn; return node; };
      if (String(method).startsWith('on_')) return fn => { obj.events[method] = fn; return node; };
      return (...args) => { obj.styles.push([method, ...args]); return node; };
    }});
    state.nodes.push(node); return node;
  }
  const sandbox = {
    View:class {}, localStorage:{getItem:key => currentStore[key] ?? null, setItem:(key, value) => { currentStore[key] = value; }},
    spaces:() => state.spaces, machines:() => state.machines, props:() => state.props,
    shared:key => state.shared[key], setShared:(key, value) => { state.shared[key] = value; state.updates++; },
    home:() => '/home/local', agents:() => state.agents ?? [], panes:() => state.panes ?? [], window:() => ({platform:'linux'}),
    theme:() => ({selected:'selected', dim:'dim', foreground:'foreground'}),
    div:element, h_flex:element, v_flex:element, image:element, svg:element,
    run:(command, args) => state.actions.push({command, args:plain(args)}),
    openOverlay:options => state.overlays.push(plain(options)), closeOverlay:id => state.closed.push(id),
    notify:notice => state.notices.push(notice),
    exec:async (command, args, options) => {
      state.calls.push({command, args:plain(args), options:options && plain(options)});
      if (command === 'herdr-app') return {code:0, stdout:JSON.stringify({space:`made-${state.calls.length}`})};
      return {code:0, stdout:state.root ?? options.cwd};
    },
  };
  const {TaskTree, key} = vm.runInNewContext(source + '\n({TaskTree, key})', sandbox);
  const cx = {spawn:fn => state.queue.push(fn), notify(){}, stop_propagation(){state.stopped++;}};
  const make = () => {
    const previous = state.props; state.props = {header:true};
    const tree = new TaskTree(); tree.init(null, cx); state.props = previous;
    return tree;
  };
  const drain = async () => { while (state.queue.length) await state.queue.shift()(cx); };
  const render = tree => { state.props = {}; state.nodes = []; tree.render(cx); };
  const find = id => { const node = state.nodes.find(node => node.id === id); assert.ok(node, `rendered ${id}`); return node; };
  const click = id => find(id).events.on_click(null, cx);
  return {state, store, withStore, TaskTree, key, cx, make, drain, render, find, click};
}
const project = (root, machine = null) => ({root, machine});
const task = (id, active = false, machine = null, folder = '/work') => ({id, active, machine, folder, tabs:[{id:`tab-${id}`, panes:1}], name:id});

async function tests() {
  {
    const notes = {live:'/existing/task.md'};
    const h = harness({assignments:{live:project('/work')}, docs:notes});
    const tree = h.make(), live = {...task('live', true), name:'A long task title', named:true, tabs:[{id:'one'},{id:'two'},{id:'three'},{id:'four'}]};
    h.state.spaces = [live];
    h.state.panes = [{tab:'one',terminal:'shell'}, {tab:'one',terminal:'another-shell'}];
    const agents = ['idle','working','blocked'].map((status, i) => ({space:'live',tab:'one',terminal:`agent-${i}`,status,program:{agent:false}}));
    const style = (node, method) => node.styles.find(([name]) => name === method)?.[1];
    for (const count of [0,1,2,3]) {
      h.state.agents = [...agents.slice(0,count), {space:'other',status:'working'}];
      h.render(tree);
      const row = h.find('task-live'), titleGroup = row.nodes.at(-1), title = titleGroup.nodes[0];
      assert.equal(title.nodes[0], live.name);
      assert.equal(style(titleGroup,'gap'), 6, 'counter has a modest gap immediately after the title');
      assert.ok(titleGroup.styles.some(([name]) => name === 'flex_1'), 'the title group takes the available row width');
      assert.ok(title.styles.some(([name]) => name === 'truncate'));
      assert.equal(style(title,'min_w'), 0, 'long titles may shrink');
      assert.ok(!title.styles.some(([name]) => name === 'flex_1'), 'short titles do not push the counter to the right edge');
      assert.equal(titleGroup.nodes.length, count > 1 ? 2 : 1, 'zero or one coding agent has no counter, regardless of tab/pane count');
      if (count > 1) {
        const counter = titleGroup.nodes[1];
        assert.equal(counter.nodes[0], `${count}`, 'all states and program.agent=false entries count, but other spaces do not');
        assert.equal(counter.tip, `${count} coding agents`);
        assert.equal(style(counter,'text_size'), 10.5);
        assert.equal(style(counter,'text_color'), 'dim');
        assert.ok(counter.styles.some(([name]) => name === 'flex_none'), 'counter remains visible when title truncates');
      }
      assert.ok(!h.state.nodes.some(node => node.id === 'notes-live'), 'notes affordance is removed');
      assert.ok(!h.state.nodes.some(node => node.tip === '1 tasks'), 'project task count is removed');
      assert.equal(h.state.calls.length, 0, 'rendering never labels terminals or reads/writes notes');
      assert.deepEqual(JSON.parse(h.store.docs), notes, 'saved note links are preserved untouched');
    }
    for (const method of ['notes','listDocs','link','createDoc','chooser','labelDocs']) assert.equal(tree[method], undefined);
    const keys = JSON.parse(fs.readFileSync('config/herdr-app/keys.json','utf8'));
    assert.ok(!JSON.stringify(keys).includes('task-tree.notes'), 'notes shortcut is removed');
  }
  {
    const h = harness({assignments:{old:project('/zeta'), remote:project('/work', 'build-z')}, 'project-history':[project('/alpha'), project('/work', 'build-a')]});
    h.state.machines.push({name:'build-z', layout:'offline'}, {name:'build-a', layout:'ready'});
    const tree = h.make(); h.state.spaces = [task('old', true)];
    const groups = tree.groups();
    assert.deepEqual(plain(groups.map(g => [g.machine, g.root, g.tasks.length])), [[null,'/alpha',0],[null,'/zeta',1],['build-a','/work',0],['build-z','/work',0]], 'migrate history and stale assignments, sorted local/machine/path');
    h.state.spaces = [];
    assert.equal(tree.groups().find(g => g.root === '/zeta').tasks.length, 0, 'last task closing keeps its project');
    const restarted = h.make(); assert.deepEqual(plain(restarted.groups()), plain(tree.groups()), 'empty groups survive view restart');
    const updateCount = h.state.updates;
    restarted.groups(); restarted.groups(); assert.equal(h.state.updates, updateCount, 'unchanged grouping does not send refreshes');
    const removed = h.key(null, '/zeta');
    assert.equal(tree.removeGroup(removed), true); assert.ok(!restarted.groups().some(g => g.id === removed), 'another view sees removal');
    tree.remember(project('/unrelated'), project('/zeta'));
    assert.ok(JSON.parse(h.store['project-history']).some(p => p.root === '/zeta'), 'stale picker history is retained');
    assert.ok(!tree.groups().some(g => g.id === removed), 'unrelated remember and stale previous assignment do not restore removal');
    assert.ok(!h.make().groups().some(g => g.id === removed), 'reload does not remigrate removed history or assignments');
    h.state.spaces = [task('old', true)];
    assert.equal(restarted.groups().find(g => g.id === removed).tasks.length, 1, 'an actual live task restores its removed group');
    assert.ok(!JSON.parse(h.store['project-groups']).removed.includes(removed));
    assert.ok(tree.groups().some(g => g.id === removed), 'live reopening refreshes other views');
    assert.equal(tree.removeGroup(removed), false, 'live group cannot be removed');
    h.state.spaces = [];
    assert.ok(h.make().groups().some(g => g.id === removed), 'restored group remains after closing again');
    tree.removeGroup(removed); const staleView = h.make(); staleView.groups();
    h.state.spaces = [task('fresh', true)]; tree.savePin('fresh', project('/zeta'));
    assert.equal(staleView.groups().find(g => g.id === removed).tasks[0].id, 'fresh', 'new assignments refresh other views even when reopening a removed group');
    assert.equal(h.state.actions.length, 0, 'removal never closes tasks or touches files');
    assert.equal(h.state.calls.length, 0);
  }
  {
    const h = harness({assignments:{live:project('/live'), other:project('/other')}, 'project-history':[project('/empty')]});
    h.state.spaces = [task('live', true), task('other')]; const tree = h.make(), emptyId = h.key(null, '/empty');
    h.render(tree); h.click(`project-${emptyId}`);
    assert.equal(tree.selectedGroup, emptyId); assert.equal(h.state.actions.length, 0, 'selecting empty project does not change active task');
    h.render(tree); h.render(tree); assert.equal(tree.selectedGroup, emptyId, 'ordinary renders preserve empty selection');
    assert.ok(h.find(`project-${emptyId}`).styles.some(([method, value]) => method === 'bg' && value === 'selected'), 'empty selection is highlighted');
    tree.command('new', h.cx); await h.drain();
    assert.deepEqual(JSON.parse(h.state.calls.at(-1).args[2]), {folder:'/empty', machine:''}, 'Cmd-N uses empty selected project instead of active task');
    assert.equal(JSON.parse(h.store.assignments)[h.state.actions.at(-1).args.id].root, '/empty');
    h.render(tree); h.click(`new-${emptyId}`); await h.drain();
    assert.deepEqual(JSON.parse(h.state.calls.at(-1).args[2]), {folder:'/empty', machine:''}, '+ uses the same empty project');
    h.state.spaces = [task('live'), task('other', true)]; h.render(tree);
    assert.equal(tree.selectedGroup, h.key(null, '/other'), 'a subsequent actual active-space change supersedes selection');
    tree.command('new', h.cx); await h.drain();
    assert.deepEqual(JSON.parse(h.state.calls.at(-1).args[2]), {folder:'/other', machine:''});
    tree.command('project:1', h.cx); assert.equal(tree.selectedGroup, emptyId, 'numeric project navigation can select empty groups');
    tree.command('project-next', h.cx); assert.equal(tree.selectedGroup, h.key(null, '/live'), 'project navigation continues in sorted group order');
    tree.command('next', h.cx); assert.equal(h.state.actions.at(-1).args.id, 'live', 'task navigation still wraps across actual tasks');
    h.render(tree); h.click(`project-${emptyId}`);
    h.state.spaces = [task('unknown', true)]; h.render(tree);
    tree.savePin('unknown', project('/resolved-later')); h.render(tree);
    assert.equal(tree.selectedGroup, h.key(null, '/resolved-later'), 'actual active-space change follows its project even when assignment resolves later');
  }
  for (const machine of [null, 'remote']) {
    const h = harness(); h.state.machines = [{name:machine, layout:'ready'}];
    const tree = h.make(), fallback = tree.groups()[0];
    assert.equal(fallback.fallback, true); assert.equal(fallback.machine, machine);
    h.render(tree); h.click(`project-${fallback.id}`); tree.command('new', h.cx); await h.drain();
    assert.deepEqual(JSON.parse(h.state.calls[0].args[2]), {machine:machine ?? ''}, 'fallback uses target machine default, without passing local home or an empty root');
    const made = h.state.actions.at(-1).args.id;
    assert.equal(JSON.parse(h.store.assignments ?? '{}')[made], undefined, 'fallback task waits for its actual directory instead of pinning an empty root');
    const folder = machine ? '/remote/home/sub' : '/home/local/sub';
    h.state.root = machine ? '/remote/project' : '/local/project';
    h.state.spaces = [task(made, true, machine, folder)]; h.state.panes = [{tab:`tab-${made}`, terminal:'terminal', cwd:folder}];
    h.render(tree); await h.drain(); h.render(tree);
    const groups = tree.groups(); assert.equal(groups.length, 1); assert.ok(!groups[0].fallback); assert.equal(groups[0].root, h.state.root);
    assert.deepEqual(h.state.calls[1].options, {cwd:folder, on:machine}, 'normal lookup runs on the created task machine');
    assert.equal(tree.selectedGroup, groups[0].id, 'selection follows fallback into resolved project');
    h.state.spaces = []; assert.equal(h.make().groups()[0].root, h.state.root);
  }
  {
    const h = harness({'project-history':[project('/empty')]});
    h.state.machines.push({name:'remote', layout:'ready'}, {name:'offline', layout:'offline'}, {name:'loading', layout:'loading'});
    const tree = h.make(); h.render(tree);
    assert.deepEqual(plain(tree.groups().map(g => g.machine)), [null,'loading','offline','remote'], 'each configured machine has a sorted selectable row');
    for (const machine of ['offline', 'loading']) {
      const group = tree.groups().find(g => g.machine === machine);
      h.click(`project-${group.id}`); assert.equal(tree.selectedGroup, group.id, 'unavailable fallback stays selectable');
      assert.equal(h.find(`new-${group.id}`).tip, 'Machine unavailable');
      h.click(`new-${group.id}`); tree.command('new', h.cx); await h.drain(); assert.equal(h.state.calls.length, 0, 'unavailable machine cannot create');
    }
    const remote = tree.groups().find(g => g.machine === 'remote'); h.click(`new-${remote.id}`); await h.drain();
    assert.deepEqual(JSON.parse(h.state.calls[0].args[2]), {machine:'remote'}, 'fallback + also targets the remote default directory');
    const local = tree.groups().find(g => g.machine === null); h.state.machines[0].layout = 'offline';
    tree.newTask(local, h.cx); await h.drain(); assert.equal(h.state.calls.length, 1, 'unavailable real project is also creation-disabled');
  }
  {
    const h = harness({assignments:{live:project('/live')}, 'project-history':[project('/empty')]});
    h.state.spaces = [task('live', true)]; const tree = h.make(), otherView = h.make(), emptyId = h.key(null, '/empty');
    h.render(tree); h.find(`project-${emptyId}`).events['mouse:right'](null, h.cx);
    assert.equal(h.state.stopped, 1); assert.equal(h.state.overlays[0].props.group, emptyId);
    h.state.props = {...h.state.overlays[0].props, overlay:'popup'};
    const popupStore = {}, popup = new h.TaskTree();
    h.withStore(popupStore, () => {
      popup.init(null, h.cx); assert.equal(h.state.queue.length, 0, 'popup does not consume task commands');
      h.state.nodes = []; popup.render(h.cx);
      assert.ok(h.find('remove-group').styles.some(([method]) => method === 'cursor_pointer'), 'empty group removal is enabled with independent popup storage');
      h.click('remove-group');
    });
    assert.deepEqual(popupStore, {}, 'popup does not read or write a private group registry');
    assert.ok(tree.groups().some(g => g.id === emptyId), 'removal is handled by the owning sidebar, not popup storage');
    h.render(otherView); assert.ok(tree.groups().some(g => g.id === emptyId), 'other sidebar copies do not consume the removal request');
    h.render(tree);
    assert.deepEqual(h.state.closed, ['popup']); assert.ok(!tree.groups().some(g => g.id === emptyId), 'owning sidebar removes empty group');
    const updates = h.state.updates; h.render(tree); assert.equal(h.state.updates, updates, 'removal request is handled once');
    assert.equal(h.state.actions.length, 0); assert.equal(h.state.calls.length, 0, 'remove group has no filesystem or live task side effects');
    h.render(tree); const liveId = h.key(null, '/live'); h.find(`project-${liveId}`).events['mouse:right'](null, h.cx);
    h.state.props = {...h.state.overlays.at(-1).props, overlay:'live-popup'}; const livePopup = new h.TaskTree();
    h.withStore({}, () => {
      livePopup.init(null, h.cx); h.state.nodes = []; livePopup.render(h.cx);
      assert.match(h.find('remove-group').tip, /Close or move/); h.click('remove-group');
    });
    h.render(tree); assert.ok(tree.groups().some(g => g.id === liveId)); assert.deepEqual(h.state.closed, ['popup'], 'live removal is disabled');
    // A task can appear after opening an empty group's popup but before the sidebar handles removal.
    h.state.spaces = []; h.render(tree); h.find(`project-${liveId}`).events['mouse:right'](null, h.cx);
    h.state.props = {...h.state.overlays.at(-1).props, overlay:'race-popup'};
    h.withStore({}, () => { const menu = new h.TaskTree(); menu.init(null, h.cx); h.state.nodes = []; menu.render(h.cx); h.click('remove-group'); });
    h.state.spaces = [task('live', true)]; h.render(tree); assert.ok(tree.groups().some(g => g.id === liveId), 'sidebar revalidates live tasks before removal');
    assert.equal(tree.removeGroup(h.key('missing', null)), false);
  }
  console.log('task group behavior tests passed');
}

function nativeChecks() {
  if (!process.argv.includes('--native')) return;
  for (const mode of ['groups', 'menu', 'row-short', 'row-long']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-groups-check-'));
    try {
      for (const file of ['mod.json', 'artifact-logic.js']) fs.copyFileSync(`${modPath}/${file}`, `${dir}/${file}`);
      const seed = `localStorage.setItem("project-groups", JSON.stringify({projects:[{machine:null,root:"/empty"},{machine:"native-remote",root:"/remote/project"}],removed:[]}));`;
      const code = original.replace('  init(_props, cx) {', `  init(_props, cx) {\n    ${seed}`)
        .replace('    if (props()?.projectPicker) return this.projectPicker();', mode === 'menu'
          ? '    return this.projectMenu();'
          : mode.startsWith('row-')
            ? `    return this.row({id:"native-group"}, {id:"native-task",name:${JSON.stringify(mode === 'row-long' ? 'A long task title that must truncate while its coding agent count stays visible'.repeat(3) : 'Task')},named:true,tabs:[],status:"idle"}, [{space:"native-task",status:"idle"},{space:"native-task",status:"working"},{space:"native-task",status:"blocked"}], theme());`
            : '    if (props()?.projectPicker) return this.projectPicker();')
        .replace('props().removable === true', 'true');
      fs.writeFileSync(`${dir}/main.js`, code);
      const result = child.spawnSync('herdr-app', ['check', dir], {encoding:'utf8', timeout:30000});
      assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
      console.log(`native task ${mode} check passed`);
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  }
}
tests().then(nativeChecks).catch(error => { console.error(error); process.exitCode = 1; });
