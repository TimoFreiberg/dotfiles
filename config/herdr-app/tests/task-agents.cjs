const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = 'config/herdr-app/mods/';
const logic = fs.readFileSync(base + 'task-tree/agent-logic.js', 'utf8').replace(/^export /gm, '');
const {taskAgents, taskAgentStatus, observeTaskAgents} = vm.runInNewContext(logic + '\n({taskAgents, taskAgentStatus, observeTaskAgents})');
const local = {id:'s', machine:null, active:true, tabs:[{id:'t'}]};
const remote = {id:'box/s', machine:'box', active:false, tabs:[{id:'box/t'}]};
let spaces = [local, remote], panes = [{tab:'t',terminal:'root'}, {tab:'box/t',terminal:'box/root'}];
const agent = (address, parent, status, extra = {}) => ({address,parent,status,state:'live',program:{agent:true,name:address},...extra});
let terminals = [agent('root',null,'working'), agent('child','root','error'), agent('grand','child','working'),
  agent('shell','root','working',{program:{agent:false}}), agent('done','root','done'),
  agent('label',null,'idle',{labels:{'herdr.space':'s'}}), agent('missing','absent','blocked'),
  agent('cycle1','cycle2','blocked'), agent('cycle2','cycle1','blocked'),
  agent('box/root',null,'working'), agent('box/child','box/root','blocked'),
  agent('box/label',null,'blocked',{labels:{'herdr.space':'s'}}), agent('box/ambiguous','root','blocked'),
  agent('ended','root','blocked',{state:'done',report:{}})];
let listed = [{address:'root',space:'s',status:'working',program:{agent:true}}, {address:'box/root',space:'box/s',status:'idle',program:{agent:true}}];
const get = s => taskAgents(s, listed, panes, spaces, terminals);
assert.equal(get(local).map(a => a.address).join(','), 'root,child,grand,done,label');
assert.equal(get(remote).map(a => a.address).join(','), 'box/root,box/child,box/label');
assert.equal(get(local).find(a => a.address === 'child').status, 'blocked');
assert.equal(get(local).find(a => a.address === 'done').status, 'idle');
for (const [statuses, expected] of [[[],null],[['idle'], 'idle'],[['working','idle'],'working'],[['working','done'],'done'],[['done','blocked'],'blocked']])
  assert.equal(taskAgentStatus(statuses.map(status => ({status}))), expected);
assert.equal(taskAgentStatus(get(local)), 'blocked');
const shapes = [
  {address:'root',state:'live'},
  {address:'claude-child',parent:'root',state:'live',status:null,report:null,program:{key:'claude',name:'Claude',agent:false,shell:false}},
  {address:'report-child',parent:'root',state:'live',status:'blocked',report:{state:'blocked'},program:{key:'program',agent:false,shell:false}},
  {address:'string-report',parent:'root',state:'live',status:'working',report:'working',program:{key:'program',agent:false,shell:false}},
  {address:'shell-child',parent:'root',state:'live',status:'working',report:{state:'working'},program:{key:'shell',agent:false,shell:true}},
  {address:'other-child',parent:'root',state:'live',status:null,report:null,program:{key:'program',agent:false,shell:false}},
];
const classified = taskAgents(local, [], panes, spaces, shapes, {'':['claude']});
assert.equal(classified.map(a => a.address).join(','), 'claude-child,report-child,string-report');
assert.equal(taskAgentStatus(classified), 'blocked');
const root = agent('root',null,'idle'), work = agent('work','root','working');
let snapshots = [root,work], state = observeTaskAgents(spaces, panes, snapshots);
assert.equal(state.work.space,'s'); assert.equal(state.work.unseen,false);
snapshots = [root,{...work,status:'idle'}]; state = observeTaskAgents(spaces, panes, snapshots,state);
assert.equal(state.work.unseen,true);
assert.equal(taskAgents(local, [], panes, spaces, snapshots, {}, state)[0].status,'done');
let doneState = observeTaskAgents(spaces, panes, [root,{...work,status:'done'}]);
assert.equal(doneState.work.unseen,true, 'first observed raw done is unseen');
const workState = observeTaskAgents(spaces, panes, [root,work]);
doneState = observeTaskAgents(spaces, panes, [root,{...work,status:'done'}],workState);
assert.equal(doneState.work.unseen,true, 'working to done is unseen');
const seenTurn = observeTaskAgents(spaces, panes, [root,{...work,status:'done',turn:4,labels:{'herdr.seen':'4'}}]);
assert.equal(seenTurn.work.unseen,false,'core seen turn takes precedence');
state = observeTaskAgents(spaces,[...panes,{pane:'p',tab:'t',terminal:'work',focused:true}],snapshots,state,true);
assert.equal(state.work.unseen,false,'viewing clears unseen');
state = observeTaskAgents(spaces,panes,[snapshots[1]],state);
assert.equal(state.work.space,'s','live child retains observed task after parent exits');
assert.equal(taskAgents(local, [], panes, spaces, [snapshots[1]], {}, state)[0].address,'work');
const other = {id:'other',machine:null,tabs:[{id:'other-tab'}]};
state = observeTaskAgents([...spaces,other],[{tab:'other-tab',terminal:'work'}],[snapshots[1]],state);
assert.equal(state.work.space,'other','pane move replaces cached owner');
state = observeTaskAgents(spaces,[],[snapshots[1]],state);
assert.equal(state.work.space,null,'deleted task cannot retain its association');
const parked = agent('parked',null,'idle',{labels:{'herdr.space':'s'}});
state = observeTaskAgents(spaces,[],[parked]);
state = observeTaskAgents(spaces,[],[{...parked,labels:{'herdr.space':''}}],state);
assert.equal(state.parked.space,'s','parking clears the label but retains observed owner');
state = observeTaskAgents(spaces,[],[{...parked,parent:'unknown',labels:{}}],state);
assert.equal(state.parked.space,null,'a changed parent invalidates an unverified owner');
assert.equal(observeTaskAgents(spaces,[],[agent('unknown','missing','idle')]).unknown.space,null);

function el(kind = 'div') {
  const o = {kind,nodes:[],events:{},calls:[]};
  const p = new Proxy(o, {get(t,k) {
    if (k in t) return t[k];
    if (k === 'child') return x => {t.nodes.push(x);return p;};
    if (k === 'children') return xs => {t.nodes.push(...xs);return p;};
    if (k === 'when') return (b,f) => {if(b) f(p);return p;};
    if (k === 'id') return x => {t.id=x;return p;};
    if (typeof k === 'string' && k.startsWith('on_')) return (...x) => {t.events[k + (typeof x[0] === 'string' ? ':'+x[0] : '')]=x.at(-1);return p;};
    return (...args) => {t.calls.push([k,...args]);return p;};
  }}); return p;
}
function find(e,id) { if (!e || typeof e !== 'object') return null; if (e.id === id) return e; for (const n of e.nodes ?? []) {const r=find(n,id);if(r)return r;} return null; }
const actions = [], overlays = [], events = {}, binds = [], scrolled = [];
let props = {space:'s',overlay:'overlay'}, value = '', sharedData = {};
const filter = {on:(name,fn) => {events[name]=fn;}, value:()=>value, focus(){}, release(){this.released=true;}};
const cx = {focus_handle:()=>({}), bind_keys:x=>binds.push(...x), notify(){}, stop_propagation(){}, spawn(){}};
const sandbox = {View:class {}, div:()=>el(), svg:()=>el('svg'), image:()=>el('image'), h_flex:()=>el(), v_flex:()=>el(),
  InputState:{new:()=>filter}, Input:{new:()=>el()}, VirtualListScrollHandle:{new:()=>({scroll_to_item:i=>scrolled.push(i)})},
  Scrollbar:{vertical:()=>el()}, v_virtual_list:(_id,_n,_h,_key,render)=>{const x=el();x.id=_id;x.children(render({start:0,end:_n}));return x;},
  spaces:()=>spaces, panes:()=>panes, agents:()=>listed, terminals:()=>terminals, taskAgents, taskAgentStatus, observeTaskAgents,
  props:()=>props, theme:()=>({blocked:'blocked',done:'done',working:'working',dim:'dim'}), run:(...args)=>actions.push(args), closeOverlay:id=>actions.push(['close',id]),
  openOverlay:x=>overlays.push(x), shared:key=>sharedData[key], setShared:(key,value)=>{sharedData[key]=value;},
  machines:()=>[{name:null,layout:'ready'}], knownAgents:async()=>[{key:'claude'}],
  layout:()=>({}), window:()=>({active:true}), settings:()=>({zoom:1}), localStorage:{getItem:()=>null,setItem(){}},
};
function load(file, name) {return vm.runInNewContext(fs.readFileSync(base+file+'/main.js','utf8').replace(/^import .*;\n/gm,'').replace('export default class','class')+`\n${name}`,sandbox);}
const Picker = load('task-agents','TaskAgents');
let picker = new Picker(); picker.init({},cx);
assert.equal(binds.length,5); assert.equal(picker.items().length,4);
let rendered = picker.render(cx); assert.ok(rendered.events['on_action:task-agent-next']);
value='grand'; events.change(null,cx); assert.equal(picker.items()[0].address,'grand'); events.submit(null,cx);
assert.equal(JSON.stringify(actions.splice(0)),JSON.stringify([['terminal.keep',{terminal:'grand',place:'tab'}],['close','overlay']]));
value=''; picker = new Picker(); picker.init({},cx); picker.action('task-agent-next',cx); assert.equal(picker.selected,'grand'); picker.action('task-agent-prev',cx); assert.equal(picker.selected,'child');
find(picker.render(cx),'agent-choices').events.on_item_click('child',cx); assert.equal(actions[0][0],'terminal.keep'); actions.length=0;
// A visible layout terminal block may compete with the model pane for terminal-based focus.
sandbox.layout = () => ({id:'root',children:[{id:'visible-block',type:'terminal',terminal:'child'}]});
picker = new Picker(); picker.init({},cx); panes.push({pane:'model-pane',tab:'t',terminal:'child'}); picker.open('child',cx);
assert.equal(JSON.stringify(actions.splice(0)),JSON.stringify([['pane.focus',{pane:'model-pane'}],['close','overlay']])); panes.pop();
picker = new Picker(); picker.init({},cx); local.active=false; picker.open('child',cx); assert.equal(actions.length,0); assert.match(picker.error,/Select/); local.active=true;
picker = new Picker(); picker.init({},cx); picker.action('task-agent-close',cx); picker.open('child',cx); assert.equal(actions.length,1); actions.length=0;
picker = new Picker(); picker.init({},cx); panes.push({tab:'box/t',terminal:'child'}); picker.open('child',cx); assert.equal(actions.length,0); assert.match(picker.error,/another task/); panes.pop();
picker = new Picker(); picker.init({},cx); terminals = terminals.filter(t=>t.address !== 'child'); picker.open('child',cx); assert.equal(actions.length,0); assert.match(picker.error,/no longer/);
props = {space:'box/s',overlay:'remote-overlay'}; local.active=false; remote.active=true;
picker = new Picker(); picker.init({},cx); picker.open('box/child',cx);
assert.equal(JSON.stringify(actions.splice(0)),JSON.stringify([['terminal.keep',{terminal:'box/child',place:'tab'}],['close','remote-overlay']]));
remote.active=false; local.active=true; props = {space:'s',overlay:'overlay'};
// The task row and the top button render the same shared status result.
terminals.push(agent('child','root','error'));
const Tabs = load('task-tabs','Tabs'); const tabs = new Tabs(); tabs.panels={};
const tabRoot = tabs.render(), button=find(tabRoot,'agents-open'); assert.ok(button); assert.ok(button.nodes.some(n => n?.calls?.some(c => c[0]==='bg' && c[1] === 'blocked')));
button.events.on_click(); assert.equal(overlays[0].mod,'task-agents'); assert.equal(overlays[0].props.space,'s');
const Tree = load('task-tree','TaskTree'); const sidebar = new Tree(); let rowStatus; sidebar.status = status => {rowStatus=status;return el();};
sidebar.row({},local,listed,{}); assert.equal(rowStatus,taskAgentStatus(get(local))); assert.equal(rowStatus,'blocked');
for (const status of ['blocked','done','working','idle',null]) {
  listed = status ? [{address:'root',space:'s',status}] : [];
  terminals = []; panes = []; sidebar.row({},local,listed,{});
  assert.equal(rowStatus,status);
  const b = find(tabs.render(),'agents-open');
  if (status === 'working') assert.ok(b.nodes.some(n => n?.kind === 'svg'));
  else if (status === 'blocked' || status === 'done') assert.ok(b.nodes.some(n => n?.calls?.some(c => c[0] === 'bg' && c[1] === status)));
  else if (status === 'idle') assert.ok(b.nodes.some(n => n?.calls?.some(c => c[0] === 'border_color' && c[1] === 'dim')));
  else assert.equal(b.nodes.length,1);
}
if (process.argv.includes('--native')) {
  const path = require('node:path'), os = require('node:os'), child = require('node:child_process');
  for (const mod of ['task-agents','task-tabs']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'herdr-task-agents-check-'));
    try {
      let source = fs.readFileSync(base+mod+'/main.js','utf8');
      if (mod === 'task-agents') {
        source = source.replaceAll('props()', '({space:"s",overlay:"picker"})')
          .replaceAll('spaces()', '([{id:"s",active:true,machine:null,tabs:[{id:"t"}]}])')
          .replaceAll('panes()', '([{tab:"t",terminal:"root"}])')
          .replaceAll('agents()', '([])')
          .replaceAll('terminals()', '([{address:"root",state:"live"},{address:"child",parent:"root",state:"live",status:"error",program:{agent:true,name:"Native agent"}}])');
      }
      fs.writeFileSync(path.join(dir,'main.js'),source);
      fs.copyFileSync(base+mod+'/mod.json',path.join(dir,'mod.json'));
      fs.copyFileSync(base+'task-tree/agent-logic.js',path.join(dir,'agent-logic.js'));
      const result = child.spawnSync('herdr-app',['check',dir],{encoding:'utf8',timeout:30000});
      assert.equal(result.status,0,result.stderr || result.stdout || String(result.error));
      console.log(`native ${mod} check passed`);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  }
}
async function verifySharedUpdates() {
  const pending = [], owner = new Tree(), updates = {spawn:fn=>pending.push(fn),notify(){}};
  spaces = [local]; panes = [{tab:'t',terminal:'root'}]; terminals = shapes.slice(0,2); listed = [];
  owner.loadAgentPrograms(terminals,updates); assert.equal(pending.length,1);
  await pending.shift()(updates);
  assert.equal(sharedData['task-agent-programs'][''][0],'claude');
  const retry = new Tree(); sandbox.knownAgents = async () => {throw new Error('offline');};
  retry.loadAgentPrograms(terminals,updates); await pending.shift()(updates);
  retry.loadAgentPrograms(terminals,updates); assert.equal(pending.length,0,'failed lookup waits before retrying');
  retry.agentProgramRetry[''] = 0; sandbox.knownAgents = async () => [{key:'claude'}];
  retry.loadAgentPrograms(terminals,updates); assert.equal(pending.length,1); await pending.shift()(updates);
  picker = new Picker(); picker.init({},cx); assert.equal(picker.items()[0].address,'claude-child');
  owner.syncAgentObservation(updates); assert.equal(pending.length,1); await pending.shift()(updates);
  assert.equal(sharedData['task-agent-observation']['claude-child'].space,'s');
  owner.syncAgentObservation(updates); assert.equal(pending.length,0,'unchanged snapshots do not republish');
  terminals[1] = {...terminals[1], status:'working'}; owner.syncAgentObservation(updates);
  terminals[1] = {...terminals[1], status:'idle'}; owner.syncAgentObservation(updates);
  assert.equal(pending.length,1,'pending writes coalesce while retaining both transitions');
  await pending.shift()(updates);
  assert.equal(sharedData['task-agent-observation']['claude-child'].unseen,true);
  assert.equal(taskAgentStatus(picker.items()),'done');
  sidebar.row({},local,[],{}); assert.equal(rowStatus,'done');
  const button = find(tabs.render(),'agents-open');
  assert.ok(button.nodes.some(n=>n?.calls?.some(c=>c[0]==='bg' && c[1]==='done')));
}
verifySharedUpdates().then(()=>console.log('task agents tests passed')).catch(error=>{console.error(error);process.exitCode=1;});
