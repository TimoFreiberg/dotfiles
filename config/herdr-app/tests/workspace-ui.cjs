const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const data = new Map(), calls = [], overlays = [];
let activeProps = {}, modelSpaces = [], modelPanes = [], modelMachines = [{ name: null, layout: "ready" }], modelWindow = {}, modelShared = {};
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
  layout: () => tree, window: () => modelWindow, props: () => activeProps, shared: key => modelShared[key],
  run: (name, args) => calls.push([name, args === undefined ? undefined : JSON.parse(JSON.stringify(args))]), openOverlay: args => overlays.push(args),
  closeOverlay: id => calls.push(["closeOverlay", id]), knownAgents: async () => [],
  localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
};
function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", "mods", file, "main.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export default class", "class") + `\nthis.Result = ${file === "workspace-tree" ? "WorkspaceTree" : file === "task-tabs" ? "Tabs" : "WorkspaceNew"};`;
  return vm.runInNewContext(source, sandbox);
}
const TabTree = load("workspace-tree"), sidebar = new TabTree();
sidebar.init(undefined, { spawn() {} });
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
assert.equal(row.nodes.length, 2, "the first live terminal's cwd is hidden");
const baselineTabs = [{ id: "baseline-first", name: "First" }, { id: "baseline-second", name: "Second" }];
const baselineSpace = { ...space, folder: modelHome, tabs: baselineTabs };
const baselinePanes = [
  { tab: baselineTabs[0].id, terminal: "first", title: "First", cwd: `${modelHome}/repo`, program: {} },
  { tab: baselineTabs[1].id, terminal: "second", title: "Second", cwd: `${modelHome}/repo`, program: {} },
];
for (const testTab of baselineTabs) {
  assert.equal(sidebar.row(baselineSpace, testTab, baselinePanes, {}).nodes.length, 2,
    "live first terminal cwd, not stale stored home, is the workspace baseline");
}

const differingPanes = [baselinePanes[0], { ...baselinePanes[1], cwd: `${modelHome}/repo/sub` }];
assert.equal(sidebar.row(baselineSpace, baselineTabs[1], differingPanes, {}).nodes[2].nodes[0], "~/repo/sub", "a different live cwd remains visible");
const reversePanes = [...baselinePanes].reverse();
reversePanes[0] = { ...reversePanes[0], cwd: `${modelHome}/other` };
assert.equal(sidebar.row(baselineSpace, baselineTabs[0], reversePanes, {}).nodes.length, 2, "tab order takes precedence over global pane order");
const splitBaseline = [
  { tab: baselineTabs[0].id, terminal: null, cwd: "/mod" },
  { tab: baselineTabs[0].id, terminal: "no-cwd", cwd: "" },
  { ...baselinePanes[0], cwd: "/first-live/" },
  { ...baselinePanes[0], terminal: "later", cwd: "/later" },
];
assert.equal(sandbox.workspacePath(baselineSpace, splitBaseline, modelHome), "/first-live/", "the first terminal pane with a live cwd supplies the baseline");

function renderCwdRow(cwd, folder, machine = null) {
  const id = `cwd-${++cwdTestId}`;
  const testTab = { id, name: id, named: false, active: false };
  const baselineTab = { id: `${id}-baseline` };
  const testSpace = { ...space, id: `${id}-space`, folder, machine, tabs: [baselineTab, testTab] };
  const baseline = { tab: baselineTab.id, terminal: baselineTab.id, cwd: folder || (machine == null ? modelHome : null) };
  const terminal = { tab: id, terminal: id, title: id, cwd, program: {} };
  return sidebar.row(testSpace, testTab, [baseline, terminal], {});
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
assert.equal(childNode.calls.some(([name]) => name === "text_ellipsis_start"), true, "long cwd paths truncate at the start");
const nearPrefix = `${modelHome}-archive/project`;
assert.equal(renderCwd(nearPrefix, "/workspace").nodes[0], nearPrefix, "sibling prefixes are not home paths");
const equalPathRow = renderCwdRow("/workspace/", "/workspace");
assert.equal(equalPathRow.nodes.length, 2, "equal cwd has no trailing cwd node");
assert.equal(equalPathRow.nodes[1].calls.some(([name]) => name === "flex_1"), true, "the title keeps the freed cwd width");
assert.equal(renderCwd("/workspace/sub", "/workspace").nodes[0], "/workspace/sub", "a different cwd remains visible");
assert.equal(sandbox.workspacePath({ ...space, folder: "/stored/", tabs: [tab] }, [], modelHome), "/stored/", "stored folder is the fallback without a live cwd");
assert.equal(sandbox.workspacePath({ ...space, folder: "", tabs: [tab] }, [], modelHome), modelHome, "empty local stored folder means home");
assert.equal(sandbox.workspacePath({ ...space, folder: "", machine: "builder", tabs: [tab] }, [], null), null, "empty remote stored folder is not local home");
assert.equal(sandbox.workspacePath({ ...space, folder: undefined, tabs: [tab] }, [], modelHome), null, "an unavailable stored folder stays unknown");
const callsBeforeRemote = homeCalls;
const remotePath = `${modelHome}/remote/project`;
assert.equal(renderCwd(remotePath, "/remote/workspace", "builder").nodes[0], remotePath, "remote paths are not abbreviated with local home");
assert.equal(homeCalls, callsBeforeRemote, "remote spaces do not request local home");
assert.equal(sandbox.cwdDisplay({ machine: "builder" }, modelHome, null, null).text, modelHome, "a remote path that looks like local home stays full without a workspace path");
const iconTheme = { muted: "muted", dim: "dim", foreground: "foreground", selected: "selected", chrome: "chrome", hover: "hover" };
const agentTab = { id: "agent-tab", name: "Agent", named: false, active: false, status: "working" };
const agentSpace = { ...space, id: "agent-space", index: 4, folder: "/workspace", tabs: [agentTab] };
const ordinaryPane = { tab: agentTab.id, terminal: "shell-pane", title: "Shell", cwd: "/workspace", program: {} };
const agentPane = { tab: agentTab.id, terminal: "agent-pane", title: "Agent session", cwd: "/workspace", program: { agent: true, name: "Codex", icon: "icons/codex.svg", tint: true } };
const anotherAgentPane = { tab: agentTab.id, terminal: "other-agent", title: "Other agent", cwd: "/workspace", program: { agent: true, name: "Other", icon: "icons/other.svg", tint: true } };
const agentRow = sidebar.row(agentSpace, agentTab, [ordinaryPane, agentPane, anotherAgentPane], iconTheme);
assert.equal(agentRow.nodes[0].source, "mods/workspace-chrome/spinner.svg", "the working session spinner remains first");
const workingHeader = lookup(sidebar.space({ ...agentSpace, status: "working" }, [], iconTheme, true), "workspace-agent-space");
assert.equal(workingHeader.nodes.length, 4, "a working workspace has no status marker or spacer");
for (const status of ["blocked", "done"]) {
  const header = lookup(sidebar.space({ ...agentSpace, status }, [], { ...iconTheme, [status]: status }, true), "workspace-agent-space");
  assert.equal(header.nodes.length, 5, `${status} workspace retains its status marker`);
  assert.equal(header.nodes[3].calls.find(([name]) => name === "bg")[1], status);
}
assert.equal(agentRow.nodes[1].kind, "svg");
assert.equal(agentRow.nodes[1].source, "icons/codex.svg", "the chosen representative's agent icon is shown");
assert.equal(agentRow.nodes[1].calls.find(([name]) => name === "text_color")[1], "muted", "tinted SVG icons use Herdr's tint behavior");
assert.equal(agentRow.nodes[2].nodes[0], "Agent session");
const reorderedAgentRow = sidebar.row(agentSpace, agentTab, [anotherAgentPane, agentPane, ordinaryPane], iconTheme);
assert.equal(reorderedAgentRow.nodes[1].source, "icons/other.svg", "the first agent icon follows pane order, independently of the representative");
assert.equal(reorderedAgentRow.nodes[2].nodes[0], "Agent session", "the representative title stays stable across pane ordering");
const shellTab = { id: "shell-tab", name: "Shell", named: false, active: false };
const shellPane = { tab: shellTab.id, terminal: "shell", title: "Shell session", cwd: "/workspace", program: {} };
const fallbackAgent = { tab: shellTab.id, terminal: "agent-z", title: "Later agent", cwd: "/workspace", program: { agent: true, icon: "icons/later.png", tint: true } };
const earlierFallbackAgent = { tab: shellTab.id, terminal: "agent-a", title: "Earlier agent", cwd: "/workspace", program: { agent: true, icon: "icons/full-color.png", tint: false } };
sidebar.representatives[shellTab.id] = shellPane.terminal;
const shellSpace = { ...space, id: "shell-space", folder: "/workspace", tabs: [shellTab] };
const shellRow = sidebar.row(shellSpace, shellTab, [fallbackAgent, shellPane, earlierFallbackAgent], iconTheme);
assert.equal(shellRow.nodes[1].kind, "svg", "tinted agent icons use svg");
assert.equal(shellRow.nodes[1].source, "icons/later.png", "the first agent icon follows pane order, not terminal address");
assert.equal(shellRow.nodes[2].nodes[0], "Shell session", "an agent icon does not replace an ordinary representative's title");
const reorderedShellRow = sidebar.row(shellSpace, shellTab, [earlierFallbackAgent, fallbackAgent, shellPane], iconTheme);
assert.equal(reorderedShellRow.nodes[1].kind, "image", "full-color agent icons use image");
assert.equal(reorderedShellRow.nodes[1].source, "icons/full-color.png", "reordering changes the first icon");
assert.equal(reorderedShellRow.nodes[2].nodes[0], "Shell session", "icon selection does not change the shell representative title");
assert.equal(row.nodes.some(node => node?.kind === "svg" || node?.kind === "image"), false, "ordinary panes do not receive a shell icon");
for (const count of [0, 1]) {
  assert.equal(sidebar.row(space, { ...tab, panes: count }, modelPanes, iconTheme).nodes.length, 2, "zero and one panes have no count");
}
const splitRow = sidebar.row(space, { ...tab, panes: 3 }, modelPanes, iconTheme);
assert.equal(splitRow.nodes[2].nodes[0], "3", "multiple panes show their count after the title");
assert.equal(splitRow.nodes[2].tip, "3 panes");
assert.equal(splitRow.nodes[2].calls.find(([name]) => name === "text_color")[1], "dim");
modelWindow = { platform: "macos" };
modelMachines = [{ name: null, layout: "ready" }, { name: "offline", layout: "unavailable" }, { name: "remote", layout: "ready" }];
modelSpaces = [
  { id: "remote-nine", name: "Remote", index: 9, machine: "remote", tabs: [], status: "working" },
  { id: "local-one", name: "Local", index: 1, machine: null, tabs: [], status: "working" },
  { id: "offline-four", name: "Offline", index: 4, machine: "offline", tabs: [], status: "working" },
  { id: "local-ten", name: "Ten", index: 10, machine: null, tabs: [], status: "working" },
];
const grouped = sidebar.render();
for (const [id, index, name] of [["remote-nine", 9, "Remote"], ["local-one", 1, "Local"], ["offline-four", 4, "Offline"]]) {
  const header = lookup(grouped, `workspace-${id}`);
  assert.equal(header.nodes[0].id, `fold-${id}`);
  assert.equal(header.nodes[1].nodes[0], `${index}`, "badge uses the native index rather than group position");
  assert.equal(header.nodes[1].tip, `Cmd+${index}`);
  assert.equal(header.nodes[1].calls.find(([method]) => method === "text_color")[1], "dim");
  assert.equal(header.nodes[1].calls.find(([method]) => method === "text_size")[1], 11);
  assert.equal(header.nodes[2].nodes[0], name);
  assert.equal(header.nodes[3].id, `new-${id}`);
}
const localHeader = lookup(grouped, "workspace-local-one");
localHeader.nodes[2].events.on_click();
assert.deepEqual(calls.splice(0), [["space.select", { id: "local-one" }]]);
let stopped = false;
localHeader.events["on_mouse_down:right"]({}, { stop_propagation() { stopped = true; } });
assert.equal(stopped, true);
assert.equal(overlays.pop().props.target.id, "local-one");
lookup(grouped, "new-offline-four").events.on_click({}, { stop_propagation() {} });
assert.equal(overlays.length, 0, "offline workspace cannot create a session");
assert.equal(lookup(grouped, "workspace-local-ten").nodes[1].nodes[0], "Ten", "index 10 has no badge");
for (const index of [0, -1, 1.5, "1", null, undefined]) {
  const header = lookup(sidebar.space({ ...space, index, status: "working" }, [], iconTheme, true), "workspace-s1");
  assert.equal(header.nodes[1].nodes[0], space.name, `invalid index ${index} has no badge`);
}
modelWindow = { platform: "linux" };
assert.equal(lookup(sidebar.render(), "workspace-local-one").nodes[1].tip, "Workspace 1", "Linux does not advertise a Cmd binding");
modelWindow = {}; modelMachines = [{ name: null, layout: "ready" }]; modelSpaces = [space];
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
const workspaceLayout = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "layouts", "workspace-tasks.json"), "utf8"));
const findLayout = (node,id) => node?.id === id ? node : (node?.children ?? []).map(child => findLayout(child,id)).find(Boolean) ?? null;
const panelLayout = findLayout(workspaceLayout,"panel-body"), tabsLayout = findLayout(workspaceLayout,"tabs"), sidebarLayout = findLayout(workspaceLayout,"sidebar");
assert.deepEqual(panelLayout.children.map(child => child.id), ["files","changes"], "the workspace side panel contains only Files and Changes");
assert.equal(tabsLayout.content.mod, "task-tabs", "the task tabs command listener is mounted in the always-visible work area");
assert.equal(findLayout(sidebarLayout, "tabs"), null, "task tabs are not inside the hideable sidebar");
const Tabs = load("task-tabs"), artifactSpace = { id: "artifact-space", name: "Artifacts", active: true, tabs: [] };
modelSpaces = [artifactSpace]; modelPanes = []; modelWindow = {};
modelShared = { "workspace.panels": ["files","changes","artifacts"], "task-artifacts": { "artifact-space": [{path:"/one.html",title:"One",seen:false},{path:"/two.html",title:"Two",seen:true}] } };
data.set("panels", JSON.stringify({ "artifact-space": "artifacts" }));
tree = { id: "root", children: [{ id: "sidebar", hidden: false, size: { px: 320 } }, { id: "panel", hidden: true, children: [{ id: "panel-body", active: "files" }] }] };
let resolveTabsCommand, tabsListener, tabsNotifications = 0;
sandbox.nextCommand = () => new Promise(resolve => { resolveTabsCommand = resolve; });
const tabsCx = { notify() { tabsNotifications++; }, spawn(fn) { tabsListener = fn(this); } };
const tabs = new Tabs(); tabs.init(undefined, tabsCx); calls.length = 0; overlays.length = 0;
assert.ok(tabsListener, "task-tabs starts the command listener");
async function sendTabsCommand(command) {
  assert.equal(typeof resolveTabsCommand, "function", "task-tabs waits for its next command");
  const resolve = resolveTabsCommand; resolveTabsCommand = null; resolve(command);
  await new Promise(setImmediate);
}
const tabsRender = tabs.render(), artifactButton = lookup(tabsRender,"artifacts-open");
assert.ok(artifactButton); assert.ok(artifactButton.nodes.includes("Artifacts 1"), "the artifact button shows the unseen count");
assert.equal(lookup(tabsRender,"panel-artifacts"), null, "Artifacts is not restored as a side-panel button");
assert.equal(tree.children[1].hidden, true); assert.deepEqual(calls, [], "an obsolete saved Artifacts preference does not reopen the sidebar");
assert.equal(JSON.parse(data.get("panels"))["artifact-space"], null, "the obsolete saved preference is cleared");
artifactButton.events.on_click();
const artifactDialog = overlays.pop();
assert.equal(artifactDialog.mod, "task-artifacts"); assert.equal(artifactDialog.kind, "dialog");
assert.equal(artifactDialog.width, 600); assert.equal(artifactDialog.height, 440); assert.equal(artifactDialog.props.space, "artifact-space", "the dialog captures the active space");
assert.deepEqual(calls, [], "opening Artifacts does not toggle Files or Changes"); assert.equal(tree.children[1].hidden, true);
lookup(tabsRender,"panel-files").events.on_click(); lookup(tabsRender,"panel-changes").events.on_click();
assert.deepEqual(calls.splice(0), [["layout.select", {stack:"panel-body",child:"files"}], ["layout.show", {id:"panel"}], ["layout.select", {stack:"panel-body",child:"changes"}], ["layout.show", {id:"panel"}]], "Files and Changes remain independent panel controls");

data.delete("panels");
const legacySpace = { ...artifactSpace, id: "legacy-artifact-space" };
modelSpaces = [legacySpace];
tree = { id: "root", children: [{ id: "sidebar", hidden: false }, { id: "panel", hidden: false, children: [{ id: "panel-body", active: "artifacts" }] }] };
const legacyTabs = new Tabs(); legacyTabs.init(undefined, { spawn() {} }); calls.length = 0; legacyTabs.render();
assert.deepEqual(calls.splice(0), [["layout.hide", {id:"panel"}]], "a visible unsupported Artifacts panel is hidden before per-space restore");
assert.equal(data.has("panels"), false, "hiding the old panel does not invent a saved preference");
for (const active of ["files","changes"]) {
  data.delete("panels"); modelSpaces = [{ ...legacySpace, id: `visible-${active}` }];
  tree = { id: "root", children: [{ id: "sidebar", hidden: false }, { id: "panel", hidden: false, children: [{ id: "panel-body", active }] }] };
  const supportedTabs = new Tabs(); supportedTabs.init(undefined, { spawn() {} }); calls.length = 0; supportedTabs.render();
  assert.deepEqual(calls, [], `an already visible ${active} panel is left alone`);
}
for (const active of ["files", "changes"]) {
  const sidebarSpace = { ...legacySpace, id: `sidebar-${active}`, active: true };
  modelSpaces = [sidebarSpace]; data.delete("panels");
  tree = { id: "root", children: [{ id: "sidebar", hidden: true }, { id: "panel", hidden: false, children: [{ id: "panel-body", active }] }] };
  const sidebarTabs = new Tabs(); sidebarTabs.init(undefined, { spawn() {} }); calls.length = 0;
  const hiddenSidebarRender = sidebarTabs.render(), showSidebar = lookup(hiddenSidebarRender, "sidebar-show");
  assert.ok(showSidebar, `a hidden sidebar offers Show sidebar with ${active} selected`);
  assert.deepEqual(showSidebar.nodes, ['→'], 'the reveal button uses a right-arrow icon without a text label');
  assert.equal(showSidebar.tip, 'Show sidebar');
  assert.ok(lookup(hiddenSidebarRender, "panel-files"), "Files remains available while the sidebar is hidden");
  assert.ok(lookup(hiddenSidebarRender, "panel-changes"), "Changes remains available while the sidebar is hidden");
  let stopped = false;
  showSidebar.events["on_mouse_down:left"]({}, { stop_propagation() { stopped = true; } });
  assert.equal(stopped, true, "Show sidebar mouse-down stops propagation");
  showSidebar.events.on_click();
  assert.deepEqual(calls.splice(0), [["layout.show", { id: "sidebar" }]], "Show sidebar only reveals the sidebar");
  assert.equal(tree.children[1].hidden, false, "revealing the sidebar leaves the side panel shown");
  assert.equal(tree.children[1].children[0].active, active, `revealing the sidebar leaves ${active} selected`);

  tree.children[0].hidden = false;
  const shownSidebarRender = sidebarTabs.render();
  assert.equal(lookup(shownSidebarRender, "sidebar-show"), null, "a shown sidebar has no Show sidebar button");
  assert.ok(lookup(shownSidebarRender, "panel-files"));
  assert.ok(lookup(shownSidebarRender, "panel-changes"));
  assert.deepEqual(calls, [], `rendering with the sidebar shown leaves ${active} unchanged`);
  assert.equal(tree.children[1].hidden, false);
  assert.equal(tree.children[1].children[0].active, active);
}
async function testTaskTabsCommands() {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "keys.json"), "utf8"));
  assert.equal(keys["layout:workspace-tasks"]["cmd-shift-a"], "task-tabs.artifacts", "Cmd-Shift-A routes only in workspace-tasks");
  assert.equal(keys.global["cmd-shift-a"], undefined, "Cmd-Shift-A is not a global binding");
  assert.equal(keys["layout:workspace-tree"]["cmd-shift-a"], undefined, "Cmd-Shift-A is not bound in workspace-tree");
  assert.equal(keys.global["cmd-a"], undefined, "Cmd-A remains available to native select-all");

  const invocationSpace = { ...artifactSpace, id: "invocation-space", active: true };
  modelSpaces = [{ ...artifactSpace, active: false }, invocationSpace];
  await sendTabsCommand("unknown");
  assert.deepEqual(overlays, [], "unknown task-tabs commands are ignored");
  assert.equal(tabsNotifications, 1, "the listener notifies after consuming a command");

  await sendTabsCommand("artifacts");
  const commandDialog = overlays.pop();
  assert.equal(commandDialog.props.space, "invocation-space", "the shortcut resolves the live active space when invoked");
  assert.equal(commandDialog.mod, "task-artifacts");
  artifactButton.events.on_click();
  const clickDialog = overlays.pop();
  assert.deepEqual(clickDialog, commandDialog, "the Artifacts button and shortcut open the same modal via the shared helper");

  tree = { id: "root", children: [{ id: "sidebar", hidden: true }, { id: "panel", hidden: true }] };
  await sendTabsCommand("artifacts");
  const hiddenSidebarDialog = overlays.pop();
  assert.equal(hiddenSidebarDialog.props.space, "invocation-space", "the shortcut still opens Artifacts with the sidebar hidden");
  assert.equal(tree.children[0].hidden, true, "opening Artifacts does not reveal the hidden sidebar");
}

async function testNavigation() {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "keys.json"), "utf8"));
  const scoped = keys["layout:workspace-tree"];
  for (const [key, command] of Object.entries({ "ctrl-tab": "next", "ctrl-shift-tab": "prev", "cmd-shift-]": "next", "cmd-shift-[": "prev" })) {
    assert.equal(scoped[key], `workspace-tree.${command}`);
    assert.equal(keys.global[key], command === "next" ? "tab.next" : "tab.prev");
    assert.equal(keys.terminal[key], undefined);
  }
  for (let i = 1; i <= 9; i++) {
    assert.equal(scoped[`cmd-${i}`], `space.select:${i}`);
    assert.equal(keys.global[`cmd-${i}`], `tab.select:${i}`);
    assert.equal(keys.global[`ctrl-${i}`], `space.select:${i}`);
    assert.equal(keys.terminal[`cmd-${i}`], undefined);
  }
  assert.equal(keys.global["cmd-0"], "app.zoom_reset");
  assert.equal(scoped["cmd-0"], undefined);

  const mkSpace = (id, machine, ids) => ({ id, machine, active: false, tabs: ids.map(id => ({ id, active: false })) });
  const a = mkSpace("a", null, ["z", "b"]), b = mkSpace("b", null, ["y", "a"]);
  const off = mkSpace("off", "offline", ["off-tab"]), loading = mkSpace("loading", "loading", ["loading-tab"]);
  const remote = mkSpace("remote", "remote", ["r2", "r1"]);
  modelSpaces = [remote, a, off, b, loading];
  modelMachines = [{ name: null, layout: "ready" }, { name: "offline", layout: "unavailable" }, { name: "loading", layout: "loading" }, { name: "remote", layout: "ready" }];
  const select = (s, t) => { for (const x of modelSpaces) { x.active = x === s; for (const tab of x.tabs) tab.active = x === s && tab.id === t; } };
  sandbox.run = (name, args) => {
    calls.push([name, JSON.parse(JSON.stringify(args))]);
    if (name === "space.select") { const target = modelSpaces.find(s => s.id === args.id); for (const s of modelSpaces) s.active = s === target; }
    if (name === "tab.select") { const current = modelSpaces.find(s => s.active); for (const t of current.tabs) t.active = t.id === args.id; }
  };
  const stop = new Error("stop test listener");
  let resolveCommand, rejectCommand;
  sandbox.nextCommand = () => new Promise((resolve, reject) => { resolveCommand = resolve; rejectCommand = reject; });
  let task, notifications = 0;
  const cx = { notify() { notifications++; }, spawn(fn) { task = fn(this); } };
  activeProps = { header: true };
  const header = new TabTree(); header.init(undefined, cx);
  assert.equal(task, undefined, "header must not consume commands");
  data.set("folded", JSON.stringify({ b: true, remote: true }));
  activeProps = {};
  const body = new TabTree(); body.init(undefined, cx);
  assert.ok(task, "body starts the command listener");
  async function send(command) { resolveCommand(command); await new Promise(setImmediate); }

  select(a, "z"); await send("next");
  assert.deepEqual(calls.splice(0), [["tab.select", { id: "b" }]], "middle advances in native order");
  await send("next");
  assert.deepEqual(calls.splice(0), [["space.select", { id: "b" }], ["tab.select", { id: "y" }]], "boundary selects the next space's first tab");
  assert.deepEqual(JSON.parse(data.get("folded")), { b: false, remote: true }, "only target fold is opened");
  await send("prev");
  assert.deepEqual(calls.splice(0), [["space.select", { id: "a" }], ["tab.select", { id: "b" }]], "reverse boundary selects previous last tab");
  select(remote, "r1"); await send("next");
  assert.deepEqual(calls.splice(0), [["space.select", { id: "a" }], ["tab.select", { id: "z" }]], "global forward wraps");
  select(a, "z"); await send("prev");
  assert.deepEqual(calls.splice(0), [["space.select", { id: "remote" }], ["tab.select", { id: "r1" }]], "global reverse wraps and skips unavailable machines");
  select(b, "a"); remote.tabs[0].settled = true; await send("next");
  assert.deepEqual(calls.splice(0), [["space.select", { id: "remote" }], ["tab.select", { id: "r2" }]], "settled tabs remain in order");
  modelSpaces = []; await send("next"); assert.deepEqual(calls.splice(0), [], "empty list is a no-op");
  await send("unknown"); assert.equal(notifications, 7, "only navigation commands notify");
  rejectCommand(stop); await task.catch(error => { assert.equal(error, stop); });
}
async function runTests() {
  await testTaskTabsCommands();
  await testNavigation();
  console.log("workspace UI tests passed");
}
runTests().catch(error => { console.error(error); process.exitCode = 1; });
