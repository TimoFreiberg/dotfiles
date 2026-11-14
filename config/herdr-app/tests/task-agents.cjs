const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = 'config/herdr-app/mods/';
const logic = fs.readFileSync(base + 'task-tree/agent-logic.js', 'utf8').replace(/^export /gm, '');
const {taskAgents, taskAgentStatus} = vm.runInNewContext(logic + '\n({taskAgents, taskAgentStatus})');
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
let props = {space:'s',overlay:'overlay'}, value = '';
const filter = {on:(name,fn) => {events[name]=fn;}, value:()=>value, focus(){}, release(){this.released=true;}};
const cx = {focus_handle:()=>({}), bind_keys:x=>binds.push(...x), notify(){}, stop_propagation(){}, spawn(){}};
const sandbox = {View:class {}, div:()=>el(), svg:()=>el('svg'), image:()=>el('image'), h_flex:()=>el(), v_flex:()=>el(),
  InputState:{new:()=>filter}, Input:{new:()=>el()}, VirtualListScrollHandle:{new:()=>({scroll_to_item:i=>scrolled.push(i)})},
  Scrollbar:{vertical:()=>el()}, v_virtual_list:(_id,_n,_h,_key,render)=>{const x=el();x.id=_id;x.children(render({start:0,end:_n}));return x;},
  spaces:()=>spaces, panes:()=>panes, agents:()=>listed, terminals:()=>terminals, taskAgents, taskAgentStatus,
  props:()=>props, theme:()=>({blocked:'blocked',done:'done',working:'working',dim:'dim'}), run:(...args)=>actions.push(args), closeOverlay:id=>actions.push(['close',id]),
  openOverlay:x=>overlays.push(x), shared:()=>null, layout:()=>({}), window:()=>({}), settings:()=>({zoom:1}), localStorage:{getItem:()=>null,setItem(){}},
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
picker = new Picker(); picker.init({},cx); panes.push({tab:'t',terminal:'child'}); picker.open('child',cx);
assert.equal(JSON.stringify(actions.splice(0)),JSON.stringify([['pane.focus',{terminal:'child'}],['close','overlay']])); panes.pop();
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
console.log('task agents tests passed');
