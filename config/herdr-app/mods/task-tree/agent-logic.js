const rank = { blocked: 4, done: 3, working: 2, idle: 1 };
const machineOf = address => address?.includes("/") ? address.split("/")[0] : null;
const qualify = (id, machine) => machine ? `${machine}/${id}` : id;

// Parent and label IDs are interpreted only on the terminal's own machine.
export function taskAgents(space, listed, panes, allSpaces, terminals, programs = {}, observed = {}) {
  if (!space) return [];
  const byAddress = new Map(terminals.map(t => [t.address, t]));
  const paneSpace = new Map();
  for (const pane of panes) {
    const owner = allSpaces.find(s => s.tabs.some(t => t.id === pane.tab));
    if (pane.terminal && owner) paneSpace.set(pane.terminal, owner.id);
  }
  const belongs = terminal => {
    const machine = machineOf(terminal.address), seen = new Set();
    if (machine !== (space.machine ?? null)) return false;
    let address = terminal.address;
    while (address && !seen.has(address) && machineOf(address) === machine) {
      seen.add(address);
      if (paneSpace.has(address)) return paneSpace.get(address) === space.id;
      const record = byAddress.get(address);
      const label = record?.labels?.["herdr.space"];
      if (label) return qualify(label, machine) === space.id;
      address = record?.parent;
    }
    const cached = observed[terminal.address];
    return cached?.parent === (terminal.parent ?? null) && cached?.space === space.id;
  };
  const result = listed.filter(a => a.space === space.id).map(a => ({...a, hidden:false}));
  const visible = new Set(panes.map(p => p.terminal));
  const known = new Set(result.map(a => a.address));
  for (const terminal of terminals) {
    const program = terminal.program;
    const registered = (programs[machineOf(terminal.address) ?? ""] ?? []).includes(program?.key);
    const report = typeof terminal.report === "string" ? terminal.report : terminal.report?.state;
    const reported = !program?.shell && ["working", "blocked", "error", "done", "idle"].includes(report);
    if (terminal.state !== "live" || !(program?.agent || registered || reported) || visible.has(terminal.address) || known.has(terminal.address) || !belongs(terminal)) continue;
    const status = terminal.status === "error" ? "blocked" :
      (terminal.status === "idle" || terminal.status === "done") && observed[terminal.address]?.unseen ? "done" :
      terminal.status === "done" ? "idle" : terminal.status;
    result.push({...terminal, status: rank[status] ? status : null, hidden:true});
  }
  return result;
}
// Retain only associations previously observed in a live snapshot; a present pane or
// label wins over the cached owner. An absent task cannot receive cached terminals.
export function observeTaskAgents(spaces, panes, terminals, previous = {}, windowActive = false) {
  const spaceIds = new Set(spaces.map(s => s.id));
  const paneSpace = new Map();
  for (const pane of panes) {
    const owner = spaces.find(s => s.tabs.some(t => t.id === pane.tab));
    if (owner && pane.terminal) paneSpace.set(pane.terminal, owner.id);
  }
  const byAddress = new Map(terminals.map(t => [t.address, t]));
  const state = {};
  for (const terminal of terminals) {
    if (terminal.state !== "live" || !terminal.address) continue;
    const old = previous[terminal.address] ?? {}, machine = machineOf(terminal.address), visited = new Set();
    let address = terminal.address, owner;
    while (address && !visited.has(address) && machineOf(address) === machine) {
      visited.add(address);
      if (paneSpace.has(address)) { owner = paneSpace.get(address); break; }
      const record = byAddress.get(address), label = record?.labels?.["herdr.space"];
      if (label) { owner = qualify(label, machine); break; }
      address = record?.parent;
    }
    if (owner === undefined && old.parent === (terminal.parent ?? null)) owner = old.space;
    if (!spaceIds.has(owner)) owner = null;
    const word = terminal.status, busy = s => s === "working" || s === "blocked" || s === "error";
    let unseen = Boolean(old.unseen);
    if (busy(word)) unseen = false;
    else if (word === "done" && old.word == null) unseen = true;
    else if (word && busy(old.word)) unseen = true;
    const turn = terminal.turn, seen = terminal.labels?.["herdr.seen"];
    let seenTurn = Number.isSafeInteger(old.seenTurn) ? old.seenTurn : null;
    if (typeof seen === "string" && /^\d+$/.test(seen) && Number.isSafeInteger(Number(seen))) seenTurn = Math.max(seenTurn ?? 0, Number(seen));
    const looking = windowActive && panes.some(p => p.terminal === terminal.address && p.focused);
    if (looking && Number.isSafeInteger(turn)) seenTurn = Math.max(seenTurn ?? 0, turn);
    if (Number.isSafeInteger(turn) && seenTurn !== null && !busy(word)) unseen = turn > seenTurn;
    if (looking) unseen = false;
    state[terminal.address] = {space:owner, parent:terminal.parent ?? null, word:word ?? null, unseen, seenTurn};
  }
  return state;
}
export function taskAgentStatus(list) {
  return list.reduce((best, agent) => (rank[agent.status] ?? 0) > (rank[best] ?? 0) ? agent.status : best, null);
}
