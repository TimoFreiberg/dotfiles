import { parsePatchFiles } from '@pierre/diffs';

// A synchronous SHA-1 keeps viewed keys identical in Node and in the browser.
function sha1(text) {
  const data = new TextEncoder().encode(text), length = data.length;
  const bytes = new Uint8Array(((length + 9 + 63) >> 6) << 6); bytes.set(data); bytes[length] = 128;
  const view = new DataView(bytes.buffer); view.setUint32(bytes.length - 8, Math.floor(length / 0x20000000)); view.setUint32(bytes.length - 4, length << 3);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const rot = (n, b) => (n << b) | (n >>> (32 - b)), w = new Int32Array(80);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rot(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for (let i=0;i<80;i++) { const f=i<20?(b&c)|(~b&d):i<40?b^c^d:i<60?(b&c)|(b&d)|(c&d):b^c^d; const k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6; const t=(rot(a,5)+f+e+k+w[i])|0; e=d; d=c; c=rot(b,30); b=a; a=t; }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0;
  }
  return [h0,h1,h2,h3,h4].map(n => (n>>>0).toString(16).padStart(8,'0')).join('');
}

export function unquoteGitPath(value) {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const bytes = [], raw = value.slice(1, -1), encoder = new TextEncoder();
  for (let i=0;i<raw.length;i++) {
    if (raw[i] !== '\\') { const point = raw.codePointAt(i), ch = String.fromCodePoint(point); bytes.push(...encoder.encode(ch)); if (point > 0xffff) i++; continue; }
    const next = raw[++i];
    if (/[0-7]/.test(next)) { let oct = next; while (oct.length < 3 && /[0-7]/.test(raw[i+1] || '')) oct += raw[++i]; bytes.push(parseInt(oct, 8)); }
    else bytes.push(...encoder.encode(({ n:'\n', t:'\t', r:'\r', b:'\b', f:'\f', v:'\v', a:'\x07' })[next] ?? next));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
const strip = p => p === '/dev/null' ? p : p.replace(/^[ab]\//, '');
function headerPaths(line, oldMove, newMove) {
  const rest = line.slice('diff --git '.length), candidates = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== ' ' || !(rest.startsWith('b/', i + 1) || rest.startsWith('"b/', i + 1))) continue;
    const parts = [rest.slice(0, i), rest.slice(i + 1)];
    if (!(parts[0].startsWith('a/') || parts[0].startsWith('"a/'))) continue;
    candidates.push(parts.map(part => strip(unquoteGitPath(part))));
  }
  const matches = (value, path) => value && (value === path || unquoteGitPath(value) === path);
  return candidates.find(([a, b]) => matches(oldMove, a) && matches(newMove, b))
    || candidates.find(([a, b]) => a === b)
    || candidates[0] || [rest, rest];
}
// jj can emit literal tabs and enclosing quotes where Git uses C-quoted paths.
function patchPath(headers, marker, headerPath) {
  const value = headers.split('\n').find(line => line.startsWith(`${marker} `))?.slice(marker.length + 1);
  if (!value) return null;
  if (strip(value) === headerPath) return headerPath;
  return strip(unquoteGitPath(value.split('\t')[0]));
}
function movePath(value, headerPath) {
  return value === headerPath ? value : unquoteGitPath(value);
}
const field = (headers, name) => headers.match(new RegExp(`^${name} (.+)$`, 'm'))?.[1];

export function modelPatch(patch) {
  const chunks = patch.split(/(?=^diff --git )/m).filter(chunk => chunk.startsWith('diff --git '));
  return chunks.map(raw => {
    const headers = raw.split(/^@@ /m)[0];
    const oldMove = field(headers, 'rename from') || field(headers, 'copy from');
    const newMove = field(headers, 'rename to') || field(headers, 'copy to');
    let [oldPath, newPath] = headerPaths(raw.slice(0, raw.indexOf('\n') < 0 ? raw.length : raw.indexOf('\n')), oldMove, newMove);
    const oldHeader = patchPath(headers, '---', oldPath), newHeader = patchPath(headers, '+++', newPath);
    oldPath = oldMove ? movePath(oldMove, oldPath) : (oldHeader !== '/dev/null' && oldHeader) || oldPath;
    newPath = newMove ? movePath(newMove, newPath) : (newHeader !== '/dev/null' && newHeader) || newPath;
    const oldMode = field(headers, 'old mode') || field(headers, 'deleted file mode') || headers.match(/^index .*? (\d{6})$/m)?.[1] || null;
    const newMode = field(headers, 'new mode') || field(headers, 'new file mode') || headers.match(/^index .*? (\d{6})$/m)?.[1] || null;
    const renamed = /^rename from /m.test(headers), copied = /^copy from /m.test(headers);
    const binary = /^(Binary files .* differ|GIT binary patch)/m.test(raw);
    const status = binary ? 'binary' : /^new file mode /m.test(headers) ? 'added' : /^deleted file mode /m.test(headers) ? 'deleted' : renamed ? 'renamed' : copied ? 'copied' : oldMode && newMode && oldMode.slice(0,2) !== newMode.slice(0,2) ? 'type-change' : /^old mode /m.test(headers) && !/^@@ /m.test(raw) ? 'mode-only' : 'modified';
    const index = headers.match(/^index [0-9a-f]+\.\.([0-9a-f]+)/m)?.[1];
    let normalized = raw;
    if (renamed && !/^similarity index /m.test(headers)) normalized = raw.replace(/^rename from /m, `similarity index ${/^index /m.test(headers) ? 50 : 100}%\nrename from `);
    let parsed = null, parseError = null;
    try {
      const files = parsePatchFiles(normalized, { throwOnError: true }).flatMap(item => item.files);
      if (files.length !== 1) throw new Error('expected one parsed file');
      parsed = files[0];
    } catch (error) { parseError = String(error.message || error); }
    const noNewlineAtEof = { old: false, new: false };
    const lines = raw.split('\n');
    for (let i=1;i<lines.length;i++) if (lines[i] === '\\ No newline at end of file') { const prior=lines[i-1][0]; if (prior === '-' || prior === ' ') noNewlineAtEof.old = true; if (prior === '+' || prior === ' ') noNewlineAtEof.new = true; }
    return { raw, normalized, oldPath, newPath, oldMode, newMode, status, noNewlineAtEof, viewedKey: `${newPath}:${index || sha1(headers)}`, parsed, parseError };
  });
}
