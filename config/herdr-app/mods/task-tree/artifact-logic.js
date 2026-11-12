export const artifactKey = "task-artifacts";
export function addArtifact(list, path, title, added = Date.now()) {
  const previous = list.find(item => item.path === path);
  added = Math.max(added, (previous?.added ?? -1) + 1);
  return [{path, title, added, seen:false}, ...list.filter(item => item.path !== path)];
}
export function seeArtifact(list, path, added) { return list.map(item => item.path === path && item.added === added ? {...item, seen:true} : item); }
export function removeArtifact(list, path) { return list.filter(item => item.path !== path); }
export function artifactSpace(terminal, allPanes, allSpaces, allTerminals) {
  const visited = new Set();
  while (terminal && !visited.has(terminal)) {
    if (terminal.includes("/")) return null;
    visited.add(terminal);
    const pane = allPanes.find(p => p.terminal === terminal);
    const space = allSpaces.find(s => s.tabs.some(t => t.id === pane?.tab));
    if (space) return space.id;
    const record = allTerminals.find(t => t.address === terminal);
    if (record?.labels?.["herdr.space"] && allSpaces.some(s => s.id === record.labels["herdr.space"])) return record.labels["herdr.space"];
    terminal = record?.parent;
  }
  return null;
}
export function lavishUrl(output) {
  return /^\s*url:\s*["']?(https?:\/\/[^\s"']+)["']?\s*$/m.exec(output)?.[1] ?? null;
}
export function hasArtifactWebView(platform, availableCommands) {
  return platform === "macos" && availableCommands.some(command => command.name === "web.open");
}
export async function openArtifact(exec, item, space, {web = false, home = "", reopen = false} = {}) {
  const result = await exec("lavish-axi", [item.path, ...(reopen ? ["--reopen"] : []), "--no-open"]);
  if (result.code) throw new Error(result.stderr || result.stdout || "Lavish failed");
  if (/^\s*status:\s*user-ended\s*$/m.test(result.stdout)) return false;
  const url = lavishUrl(result.stdout);
  if (!url) throw new Error("Lavish did not return a URL");
  if (web) {
    const opened = await exec("herdr-app", ["do", "web.open", JSON.stringify({url, space, title: item.title})]);
    if (opened.code) throw new Error(opened.stderr || opened.stdout || "Could not open web tab");
  } else {
    const app = await exec("test", ["-d", `${home}/Applications/Lavish.app`]);
    const [command, args] = openCommand(url, app.code === 0);
    const opened = await exec(command, args);
    if (opened.code) throw new Error(opened.stderr || opened.stdout || "Could not open browser");
  }
  return true;
}
export function openCommand(url, hasSafariApp) {
  return hasSafariApp ? ["open", ["-a", "Lavish", url]] : ["open", ["-na", "Google Chrome", "--args", `--app=${url}`]];
}
export function age(added, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - added) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
