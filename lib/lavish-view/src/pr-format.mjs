// The first line is the title; everything after its newline is the body.
export function parsePR(text) {
  const newline = text.indexOf('\n');
  const first = (newline < 0 ? text : text.slice(0, newline)).replace(/\r$/, '');
  if (!first.startsWith('# ') || !first.slice(2).trim()) throw new Error('PR draft must start with # <title> on the first line');
  return { title: first.slice(2), body: newline < 0 ? '' : text.slice(newline + 1) };
}
export function serializePR({ title, body }) {
  if (typeof title !== 'string' || /[\r\n]/.test(title) || !title.trim()) throw new Error('PR title must be a nonempty single line');
  if (typeof body !== 'string') throw new Error('PR body must be text');
  return `# ${title}\n${body}`;
}
