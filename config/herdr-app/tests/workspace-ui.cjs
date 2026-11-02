const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const data = new Map(), calls = [], overlays = [];
let activeProps = {}, modelSpaces = [], modelPanes = [], modelMachines = [{ name: null, layout: "ready" }];
let tree = { id: "root", children: [{ id: "panel", hidden: true }, { id: "panel-body", active: "files" }] };
function el() {
  const target = { nodes: [], events: {} };
  const proxy = new Proxy(target, { get(obj, key) {
    if (key in obj) return obj[key];
    if (key === "child") return x => { obj.nodes.push(x); return proxy; };
    if (key === "children") return xs => { obj.nodes.push(...xs); return proxy; };
    if (key === "when") return (condition, fn) => { if (condition) fn(proxy); return proxy; };
    if (key === "id") return id => { obj.id = id; return proxy; };
    if (key === "tooltip") return text => { obj.tip = text; return proxy; };
    if (key.startsWith("on_")) return (...args) => { obj.events[key + (typeof args[0] === "string" ? `:${args[0]}` : "")] = args.at(-1); return proxy; };
    return () => proxy;
  }});
  return proxy;
}
function lookup(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.nodes ?? []) { const found = lookup(child, id); if (found) return found; }
  return null;
}
const sandbox = {
  View: class {}, div: el, svg: el, image: el, h_flex: el, v_flex: el,
  spaces: () => modelSpaces, panes: () => modelPanes, machines: () => modelMachines,
  theme: () => ({}), layout: () => tree, window: () => ({}), props: () => activeProps,
  run: (name, args) => calls.push([name, args === undefined ? undefined : JSON.parse(JSON.stringify(args))]), openOverlay: args => overlays.push(args),
  closeOverlay: id => calls.push(["closeOverlay", id]), knownAgents: async () => [],
  localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
};
function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", "mods", file, "main.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export default class", "class") + `\nthis.Result = ${file === "workspace-tree" ? "WorkspaceTree" : "WorkspaceNew"};`;
  return vm.runInNewContext(source, sandbox);
}
const TabTree = load("workspace-tree"), sidebar = new TabTree();
sidebar.init();
const tab = { id: "t1", name: "1", named: false, active: true }, space = { id: "s1", name: "One", active: false, machine: null, tabs: [tab] };
const first = { tab: "t1", terminal: "a", title: "First", cwd: "/one/long/path", program: { agent: true } };
const second = { tab: "t1", terminal: "b", title: "Second", cwd: "/two", program: {} };
assert.equal(sidebar.representative(tab, [first]), first);
assert.equal(sidebar.representative(tab, [second, first]), first, "focus/order/split must not change representative");
assert.equal(sidebar.representative(tab, [second]), second, "removed representative falls back");
modelSpaces = [space]; modelPanes = [second];
const row = sidebar.row(space, tab, modelPanes, {});
row.events.on_click();
assert.deepEqual(calls.splice(0), [["space.select", { id: "s1" }], ["tab.select", { id: "t1" }]]);
assert.equal(row.nodes[1].tip, "Second");
assert.equal(row.nodes[2].tip, "/two");
tab.named = true; tab.name = "Chosen";
assert.equal(sidebar.row(space, tab, modelPanes, {}).nodes[1].tip, "Chosen");
let node = sidebar.space(space, modelPanes, {}, true);
lookup(node, "fold-s1").events.on_click({}, { stop_propagation() {}, notify() {} });
assert.equal(JSON.parse(data.get("folded")).s1, true);
node = sidebar.space(space, modelPanes, {}, true);
assert.equal(lookup(node, "session-t1"), null);
lookup(node, "new-s1").events.on_click({}, { stop_propagation() {} });
assert.equal(overlays[0].props.space, "s1");
const NewMenu = load("workspace-new"), picker = new NewMenu();
activeProps = { space: "s1", machine: null, overlay: "o1" };
picker.init(null, { focus_handle: () => ({ focus() {} }), spawn() {} });
picker.start(["agent"]);
assert.deepEqual(calls.splice(0), [["closeOverlay", "o1"], ["tab.new", { space: "s1", argv: ["agent"] }]]);
modelMachines = [{ name: null, layout: "unavailable" }];
picker.start(); assert.equal(calls.length, 0);
sidebar.togglePanel("files");
assert.deepEqual(calls.splice(0), [["layout.select", { stack: "panel-body", child: "files" }], ["layout.show", { id: "panel" }]]);
console.log("workspace UI tests passed");
