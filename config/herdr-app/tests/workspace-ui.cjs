const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const data = new Map(), calls = [], overlays = [];
let activeProps = {}, modelSpaces = [], modelPanes = [], modelMachines = [{ name: null, layout: "ready" }];
let modelHome = "/home/tester", homeCalls = 0, cwdTestId = 0;
let tree = { id: "root", children: [{ id: "panel", hidden: true }, { id: "panel-body", active: "files" }] };
function el(kind = "element", source = null) {
  const target = { kind, source, nodes: [], events: {}, calls: [] };
  const proxy = new Proxy(target, { get(obj, key) {
    if (key in obj) return obj[key];
    if (key === "child") return x => { obj.nodes.push(x); return proxy; };
    if (key === "children") return xs => { obj.nodes.push(...xs); return proxy; };
    if (key === "when") return (condition, fn) => { if (condition) fn(proxy); return proxy; };
    if (key === "id") return id => { obj.id = id; return proxy; };
    if (key === "tooltip") return text => { obj.tip = text; return proxy; };
    if (typeof key === "string" && key.startsWith("on_")) return (...args) => { obj.events[key + (typeof args[0] === "string" ? `:${args[0]}` : "")] = args.at(-1); return proxy; };
    return (...args) => { obj.calls.push([key, ...args]); return proxy; };
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
  View: class {}, div: () => el("div"), svg: source => el("svg", source), image: source => el("image", source), h_flex: () => el("h_flex"), v_flex: () => el("v_flex"),
  spaces: () => modelSpaces, panes: () => modelPanes, machines: () => modelMachines,
  home: () => { homeCalls++; return modelHome; },
  theme: () => ({ muted: "muted", dim: "dim", foreground: "foreground", selected: "selected", chrome: "chrome", hover: "hover", border: "border", working: "working", blocked: "blocked", done: "done" }),
  layout: () => tree, window: () => ({}), props: () => activeProps,
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
function renderCwdRow(cwd, folder, machine = null) {
  const id = `cwd-${++cwdTestId}`;
  const testTab = { id, name: id, named: false, active: false };
  const testSpace = { ...space, id: `${id}-space`, folder, machine, tabs: [testTab] };
  const terminal = { tab: id, terminal: id, title: id, cwd, program: {} };
  return sidebar.row(testSpace, testTab, [terminal], {});
}
function renderCwd(cwd, folder, machine = null) {
  return renderCwdRow(cwd, folder, machine).nodes[2] ?? null;
}
const exactHome = renderCwd(modelHome, "/workspace");
assert.equal(exactHome.nodes[0], "~", "the exact local home path abbreviates to ~");
assert.equal(exactHome.tip, modelHome, "the tooltip keeps the full cwd");
const homeChild = `${modelHome}/projects/demo`;
const childNode = renderCwd(homeChild, "/workspace");
assert.equal(childNode.nodes[0], "~/projects/demo");
assert.equal(childNode.tip, homeChild, "the shortened cwd still has a full-path tooltip");
const nearPrefix = `${modelHome}-archive/project`;
assert.equal(renderCwd(nearPrefix, "/workspace").nodes[0], nearPrefix, "sibling prefixes are not home paths");
const equalPathRow = renderCwdRow("/workspace/", "/workspace");
assert.equal(equalPathRow.nodes.length, 2, "equal cwd has no trailing cwd node");
assert.equal(equalPathRow.nodes[1].calls.some(([name]) => name === "flex_1"), true, "the title keeps the freed cwd width");
assert.equal(renderCwd("/workspace/sub", "/workspace").nodes[0], "/workspace/sub", "a different cwd remains visible");
assert.equal(renderCwd("/workspace", undefined).nodes[0], "/workspace", "an unavailable workspace path does not suppress cwd");
const callsBeforeRemote = homeCalls;
const remotePath = `${modelHome}/remote/project`;
assert.equal(renderCwd(remotePath, "/remote/workspace", "builder").nodes[0], remotePath, "remote paths are not abbreviated with local home");
assert.equal(homeCalls, callsBeforeRemote, "remote spaces do not request local home");
assert.equal(renderCwd(modelHome, undefined, "builder").nodes[0], modelHome, "a remote path that looks like local home stays full without a workspace path");
const iconTheme = { muted: "muted", dim: "dim", foreground: "foreground", selected: "selected", chrome: "chrome", hover: "hover" };
const agentTab = { id: "agent-tab", name: "Agent", named: false, active: false, status: "working" };
const agentSpace = { ...space, id: "agent-space", folder: "/workspace", tabs: [agentTab] };
const ordinaryPane = { tab: agentTab.id, terminal: "shell-pane", title: "Shell", cwd: "/workspace", program: {} };
const agentPane = { tab: agentTab.id, terminal: "agent-pane", title: "Agent session", cwd: "/workspace", program: { agent: true, name: "Codex", icon: "icons/codex.svg", tint: true } };
const anotherAgentPane = { tab: agentTab.id, terminal: "other-agent", title: "Other agent", cwd: "/workspace", program: { agent: true, name: "Other", icon: "icons/other.svg", tint: true } };
const agentRow = sidebar.row(agentSpace, agentTab, [ordinaryPane, agentPane, anotherAgentPane], iconTheme);
assert.equal(agentRow.nodes[0].source, "mods/workspace-chrome/spinner.svg", "the status marker remains first");
assert.equal(agentRow.nodes[1].kind, "svg");
assert.equal(agentRow.nodes[1].source, "icons/codex.svg", "the chosen representative's agent icon is shown");
assert.equal(agentRow.nodes[1].calls.find(([name]) => name === "text_color")[1], "muted", "tinted SVG icons use Herdr's tint behavior");
assert.equal(agentRow.nodes[2].nodes[0], "Agent session");
const reorderedAgentRow = sidebar.row(agentSpace, agentTab, [anotherAgentPane, agentPane, ordinaryPane], iconTheme);
assert.equal(reorderedAgentRow.nodes[1].source, "icons/codex.svg", "the representative icon stays stable across pane ordering");
assert.equal(reorderedAgentRow.nodes[2].nodes[0], "Agent session", "the representative title stays stable across pane ordering");
const shellTab = { id: "shell-tab", name: "Shell", named: false, active: false };
const shellPane = { tab: shellTab.id, terminal: "shell", title: "Shell session", cwd: "/workspace", program: {} };
const fallbackAgent = { tab: shellTab.id, terminal: "agent-z", title: "Later agent", cwd: "/workspace", program: { agent: true, icon: "icons/later.png", tint: true } };
const earlierFallbackAgent = { tab: shellTab.id, terminal: "agent-a", title: "Earlier agent", cwd: "/workspace", program: { agent: true, icon: "icons/full-color.png", tint: false } };
sidebar.representatives[shellTab.id] = shellPane.terminal;
const shellSpace = { ...space, id: "shell-space", folder: "/workspace", tabs: [shellTab] };
const shellRow = sidebar.row(shellSpace, shellTab, [fallbackAgent, shellPane, earlierFallbackAgent], iconTheme);
assert.equal(shellRow.nodes[1].kind, "image", "full-color agent icons use image");
assert.equal(shellRow.nodes[1].source, "icons/full-color.png", "the fallback uses the lowest terminal address, not pane order");
assert.equal(shellRow.nodes[2].nodes[0], "Shell session", "an agent icon does not replace an ordinary representative's title");
const reorderedShellRow = sidebar.row(shellSpace, shellTab, [earlierFallbackAgent, fallbackAgent, shellPane], iconTheme);
assert.equal(reorderedShellRow.nodes[1].source, "icons/full-color.png", "fallback icon stays the same after pane reordering");
assert.equal(reorderedShellRow.nodes[2].nodes[0], "Shell session", "fallback selection does not change the shell representative title");
assert.equal(row.nodes.some(node => node?.kind === "svg" || node?.kind === "image"), false, "ordinary panes do not receive a shell icon");
const renderedSidebar = sidebar.render();
const filesTool = lookup(renderedSidebar, "files-tool"), changesTool = lookup(renderedSidebar, "changes-tool");
const settingsTool = lookup(renderedSidebar, "settings-tool"), paletteTool = lookup(renderedSidebar, "palette-tool");
const styleValue = (element, name) => element.calls.find(([method]) => method === name)?.[1];
assert.equal(styleValue(filesTool, "text_size"), 11.5);
assert.equal(styleValue(changesTool, "text_color"), "dim");
assert.equal(styleValue(settingsTool, "text_size"), 12.5);
assert.equal(styleValue(settingsTool, "text_color"), "muted");
assert.equal(styleValue(paletteTool, "text_size"), 12.5);
assert.equal(settingsTool.nodes[0].kind, "svg");
assert.equal(settingsTool.nodes[0].source, "mods/workspace-chrome/settings.svg");
assert.equal(typeof filesTool.events.on_click, "function", "subdued Files remains clickable");
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
