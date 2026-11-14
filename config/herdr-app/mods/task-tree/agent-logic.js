const rank = { blocked: 4, done: 3, working: 2, idle: 1 };
const machineOf = address => address?.includes("/") ? address.split("/")[0] : null;
const qualify = (id, machine) => machine ? `${machine}/${id}` : id;

// Parent and label IDs are interpreted only on the terminal's own machine.
export function taskAgents(space, listed, panes, allSpaces, terminals) {
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
    return false;
  };
  const result = listed.filter(a => a.space === space.id).map(a => ({...a, hidden:false}));
  const visible = new Set(panes.map(p => p.terminal));
  const known = new Set(result.map(a => a.address));
  for (const terminal of terminals) {
    if (terminal.state !== "live" || !terminal.program?.agent || visible.has(terminal.address) || known.has(terminal.address) || !belongs(terminal)) continue;
    // Herdr's shipped agent tree treats an unpaned child's done as idle.
    const status = terminal.status === "error" ? "blocked" : terminal.status === "done" ? "idle" : terminal.status;
    result.push({...terminal, status: rank[status] ? status : null, hidden:true});
  }
  return result;
}
export function taskAgentStatus(list) {
  return list.reduce((best, agent) => (rank[agent.status] ?? 0) > (rank[best] ?? 0) ? agent.status : best, null);
}
