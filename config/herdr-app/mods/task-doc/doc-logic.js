export function links(text) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const result = {};
  if (!match) return result;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(ticket|pr):\s*["']?(https?:\/\/[^\s"']+)["']?\s*$/.exec(line);
    if (field) result[field[1]] = field[2];
  }
  return result;
}
export function decision(disk, expected, local) {
  if (disk === expected) return local === expected ? "clean" : "save";
  if (local === expected || local === disk) return "reload";
  return "banner";
}
