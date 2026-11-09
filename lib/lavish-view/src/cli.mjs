import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertOutsideRepo, atomicWrite, repoRoot } from './files.mjs';
import { openReview } from './lavish.mjs';
import { ensureDeps } from './deps.mjs';
import { markdownOutputPath, writeMarkdown } from './markdown.mjs';

const usage = 'TODO(prose): usage: lavish-view <file.html|file.md|file.markdown> [--title T] [--out FILE] [--open] [--reopen] | lavish-view diff [diff options] [--title T] [--out FILE] [--open] [--reopen] [--watch]';
class UsageError extends Error {}

export function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const target = args.shift();
  if (!target || target.startsWith('-')) throw new UsageError();
  const diff = target === 'diff';
  const result = { target, diff };
  const values = new Map([['--title', 'title'], ['--out', 'out'], ...(diff ? [['-r', 'rev'], ['--from', 'from'], ['--to', 'to'], ['--repo-root', 'repoRoot']] : [])]);
  const switches = new Map([['--open', 'open'], ['--reopen', 'reopen'], ...(diff ? [['--watch', 'watch'], ['--git', 'git']] : [])]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (values.has(arg) && args[i + 1] && !args[i + 1].startsWith('-')) {
      const key = values.get(arg); if (result[key] !== undefined) throw new UsageError(); result[key] = args[++i];
    } else if (switches.has(arg)) {
      const key = switches.get(arg); if (result[key]) throw new UsageError(); result[key] = true;
    } else if (diff && arg === '-' && !result.stdin) result.stdin = true;
    else throw new UsageError();
  }
  if (diff && ((result.rev && (result.from || result.to)) || Boolean(result.from) !== Boolean(result.to) || (result.repoRoot && !result.stdin) || (result.stdin && (result.watch || result.git || result.rev || result.from || result.to)))) throw new UsageError();
  return result;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs([...args]);
    if (options.help) { console.log(usage); return 0; }
    let root;
    if (!options.diff) {
      const ext = path.extname(options.target).toLowerCase();
      if (!['.html', '.md', '.markdown'].includes(ext)) throw new UsageError();
      try { if (!(await stat(options.target)).isFile()) throw new UsageError(); } catch { throw new UsageError(); }
      root = repoRoot(path.dirname(await realpath(options.target)));
    } else root = options.repoRoot ? repoRoot(path.resolve(options.repoRoot)) || path.resolve(options.repoRoot) : repoRoot(process.cwd());
    if (options.out) await assertOutsideRepo(options.out, root);
    else if (!options.diff && path.extname(options.target).toLowerCase() !== '.html') {
      await assertOutsideRepo(markdownOutputPath(await realpath(options.target)), root);
    }
    const deps = await ensureDeps();
    if (!options.diff && path.extname(options.target).toLowerCase() !== '.html') {
      const page = await writeMarkdown(options.target, deps, options);
      await openReview(page.file, { ...options, title: options.title ?? page.title });
      return 0;
    }
    if (!options.diff && path.extname(options.target).toLowerCase() === '.html') {
      const file = options.out ? path.resolve(options.out) : path.resolve(options.target);
      if (options.out) await atomicWrite(file, await readFile(options.target));
      await openReview(file, options);
      return 0;
    }
    throw new Error('TODO(prose): renderer not implemented');
  } catch (error) {
    if (error instanceof UsageError) { console.error(usage); return 2; }
    console.error(error.message); return 1;
  }
}
