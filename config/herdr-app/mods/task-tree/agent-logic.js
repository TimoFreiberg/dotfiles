const rank = { blocked: 4, done: 3, working: 2, idle: 1 };
const machineOf = address => address?.includes("/") ? address.split("/")[0] : null;
const qualify = (id, machine) => machine ? `${machine}/${id}` : id;

// Undefined means unresolved; a present label remains authoritative even if its task is gone.
function ownership(spaces, panes, terminals, observed = {}) {
  const byAddress = new Map(terminals.map(t => [t.address, t]));
  const paneSpace = new Map();
  for (const pane of panes) {
    const owner = spaces.find(s => s.tabs.some(t => t.id === pane.tab));
    if (pane.terminal && owner) paneSpace.set(pane.terminal, owner.id);
  }
  const direct = terminal => paneSpace.get(terminal.address) ??
    (terminal.labels?.["herdr.space"] ? qualify(terminal.labels["herdr.space"], machineOf(terminal.address)) : undefined);
  const cachedDirect = terminal => {
    const cached = cachedOwner(terminal, observed);
    return observed[terminal.address]?.direct && spaces.some(s => s.id === cached && (s.machine ?? null) === machineOf(terminal.address)) ? cached : undefined;
  };
  const inherited = terminal => {
    const machine = machineOf(terminal.address), seen = new Set([terminal.address]);
    let address = terminal.parent, changed = false;
    while (address && !seen.has(address) && machineOf(address) === machine) {
      seen.add(address);
      const record = byAddress.get(address), old = observed[address];
      if (record?.state === "live" && old && old.parent !== (record.parent ?? null)) changed = true;
      const owner = direct(record ?? {address}) ?? (record?.state === "live" ? cachedDirect(record) : undefined);
      if (owner) return {owner, changed};
      address = record?.parent;
    }
    return {changed};
  };
  return terminal => {
    const directOwner = direct(terminal);
    const cached = cachedOwner(terminal, observed);
    // A cached direct task takes precedence over inheritance while it exists and the parent is unchanged.
    const own = directOwner ?? cachedDirect(terminal);
    if (own !== undefined) return own;
    const ancestry = inherited(terminal);
    // An unresolved changed chain cannot justify an inherited cached owner.
    return ancestry.owner ?? (ancestry.changed ? undefined : cached);
  };
}
function cachedOwner(terminal, observed) {
  const cached = observed[terminal.address];
  return cached?.parent === (terminal.parent ?? null) ? cached.space : undefined;
}
export function isTaskAgent(terminal, programs = {}) {
  const program = terminal?.program;
  const registered = (programs[machineOf(terminal?.address) ?? ""] ?? []).includes(program?.key);
  const report = typeof terminal?.report === "string" ? terminal.report : terminal?.report?.state;
  return terminal?.state === "live" && (program?.agent || registered || (!program?.shell && ["working", "blocked", "error", "done", "idle"].includes(report)));
}
export function taskAgents(space, listed, panes, allSpaces, terminals, programs = {}, observed = {}) {
  if (!space) return [];
  const ownerOf = ownership(allSpaces, panes, terminals, observed);
  const belongs = terminal => machineOf(terminal.address) === (space.machine ?? null) &&
    ownerOf(terminal) === space.id;
  const result = listed.filter(a => a.space === space.id).map(a => ({...a, hidden:false}));
  const visible = new Set(panes.map(p => p.terminal));
  const known = new Set(result.map(a => a.address));
  for (const terminal of terminals) {
    if (!isTaskAgent(terminal, programs) || visible.has(terminal.address) || known.has(terminal.address) || !belongs(terminal)) continue;
    const status = terminal.status === "error" ? "blocked" :
      (terminal.status === "idle" || terminal.status === "done") && observed[terminal.address]?.unseen ? "done" :
      terminal.status === "done" ? "idle" : terminal.status;
    result.push({...terminal, status: rank[status] ? status : null, hidden:true});
  }
  return result;
}
// Retain only associations previously observed in a live snapshot; a present pane or
// label wins over the cached owner. An absent task cannot receive cached terminals.
export function observeTaskAgents(spaces, panes, terminals, previous = {}, windowActive = false, focus = null) {
  const spaceIds = new Set(spaces.map(s => s.id));
  const ownerOf = ownership(spaces, panes, terminals, previous);
  // Layout terminal blocks have no model pane and are outside this observation.
  const shown = windowActive && focus?.pane && panes.some(p => p.pane === focus.pane && p.focused)
    ? focus.shown ?? focus.terminal : null;
  const state = {};
  for (const terminal of terminals) {
    if (terminal.state !== "live" || !terminal.address) continue;
    const old = previous[terminal.address] ?? {};
    let owner = ownerOf(terminal);
    if (!spaceIds.has(owner)) owner = null;
    const word = terminal.status, busy = s => s === "working" || s === "blocked" || s === "error";
    let unseen = Boolean(old.unseen);
    if (busy(word)) unseen = false;
    else if (word === "done" && old.word !== "done") unseen = true;
    else if (word && busy(old.word)) unseen = true;
    const turn = terminal.turn, seen = terminal.labels?.["herdr.seen"];
    let seenTurn = Number.isSafeInteger(old.seenTurn) ? old.seenTurn : null;
    if (typeof seen === "string" && /^\d+$/.test(seen) && Number.isSafeInteger(Number(seen))) seenTurn = Math.max(seenTurn ?? 0, Number(seen));
    const looking = shown === terminal.address;
    if (looking && Number.isSafeInteger(turn)) seenTurn = Math.max(seenTurn ?? 0, turn);
    if (Number.isSafeInteger(turn) && seenTurn !== null && !busy(word)) unseen = turn > seenTurn;
    if (looking) unseen = false;
    const direct = Boolean(owner && (terminal.labels?.["herdr.space"] || panes.some(p => p.terminal === terminal.address && spaces.some(s => s.id === owner && s.tabs.some(t => t.id === p.tab))) ||
      (old.direct && old.space === owner && old.parent === (terminal.parent ?? null))));
    state[terminal.address] = {space:owner, parent:terminal.parent ?? null, word:word ?? null, unseen, seenTurn, direct};
  }
  return state;
}
export function taskAgentStatus(list) {
  return list.reduce((best, agent) => (rank[agent.status] ?? 0) > (rank[best] ?? 0) ? agent.status : best, null);
}
