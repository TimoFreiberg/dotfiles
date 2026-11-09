export function absolutePath(root, relative) {
  return `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
}

export function zedUrl(root, relative, line) {
  const encoded = absolutePath(root, relative).split('/').map(encodeURIComponent).join('/');
  return `zed://file/${encoded}:${line}`;
}

export function zedCommand(root, relative, line) {
  const location = `${absolutePath(root, relative)}:${line}`;
  return `zed '${location.replace(/'/g, "'\\''")}'`;
}

export function commentLocation(file, range, revision) {
  const side = range.side || 'additions';
  if ((range.endSide || side) !== side) return null;
  const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end);
  const path = side === 'deletions' ? file.oldPath : file.newPath;
  const where = `${path}:${start}${start === end ? '' : `-${end}`}`;
  return { side: side === 'deletions' ? 'old' : 'new', path, start, end, where, revision: revision || 'unknown' };
}

export function quoteSelection(parsed, range) {
  const side = range.side || 'additions';
  if ((range.endSide || side) !== side) return '';
  const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end);
  const lines = side === 'additions' ? parsed.additionLines : parsed.deletionLines;
  const output = [];
  for (const hunk of parsed.hunks) {
    const first = side === 'additions' ? hunk.additionStart : hunk.deletionStart;
    const index = side === 'additions' ? hunk.additionLineIndex : hunk.deletionLineIndex;
    const count = side === 'additions' ? hunk.additionCount : hunk.deletionCount;
    for (let n = Math.max(start, first); n <= Math.min(end, first + count - 1); n++) {
      output.push(`${n}: ${(lines[index + n - first] || '').replace(/\n$/, '')}`);
    }
  }
  return output.join('\n');
}
