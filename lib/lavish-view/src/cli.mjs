import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertOutsideRepo, atomicWrite, repoRoot } from './files.mjs';
import { openReview } from './lavish.mjs';
import { retarget } from './relay.mjs';
import { ensureDeps } from './deps.mjs';
import { markdownOutputPath, writeMarkdown } from './markdown.mjs';
import { createHash } from 'node:crypto';
import { DiffUsageError, prepareDiff, readDiff, diffFingerprint } from './diff/source.mjs';
import { pagePath, writeDiffPage } from './diff/page.mjs';

const usage = `usage: lavish-view <file.html|file.md|file.markdown> [--title T] [--out FILE] [--open] [--reopen]
       lavish-view diff [-r REV | --from A --to B] [--git] [--watch] [--title T] [--out FILE] [--open] [--reopen]
       lavish-view diff - [--repo-root DIR] [--title T] [--out FILE] [--open] [--reopen]
       lavish-view retarget <page.html> [--terminal T]
Run lavish-view --help for details.`;
const help = `Open an HTML file, a markdown file, or a jj/git diff as a Lavish review page.
In a herdr terminal the page is listed under the task's Artifacts; otherwise
the URL is printed. Prints one line naming the page file. Inside herdr,
feedback is delivered automatically to the opening Polytoken session (or terminal
if it has no session label), even if artifact registration fails. Do not poll
that page yourself. Answer with lavish-axi reply <page> --agent-reply '...'.
Outside herdr, use lavish-axi poll, reply, and end as before.

usage: lavish-view <file.html|file.md|file.markdown> [options]
       lavish-view diff [range] [--git] [--watch] [options]
       lavish-view diff - [--repo-root DIR] [options]
       lavish-view retarget <page.html> [--terminal T]

Retarget sets a new live target and flushes retained feedback, including while
the old target is live. Without --terminal it selects the newest live terminal
with a polytoken.session label in the recorded herdr.space; missing/tied targets
fail rather than guess. Explicit T is a live terminal address or unique name.
Retarget does not reopen an ended page or restart its relay.

Relay files beside the canonical page:
  <page>.relay.json       terminal, session label, space, page, title, optional sourceFile
  <page>.outbox.json      retained feedback batches (created on first feedback)
  <page>.relay.lock/pid   relay PID; stale locks are reclaimed on the next open
  <page>.relay-state.lock/pid  short-lived delivery/retarget lock
Logs: ${'${XDG_STATE_HOME:-$HOME/.local/state}'}/lavish-view/relay-<page-hash>.log
Stop with lavish-axi end <page> (or Send & End in the browser). The relay also
stops on fatal artifact failures; disconnects, poll crashes/timeouts, and
LISTENER_ACTIVE retry with backoff without takeover. An explicit takeover
stops the displaced relay. Reopen only at the user's request to restart it.
For relay-only shutdown, kill -TERM the PID in <page>.relay.lock/pid. The page
stays open; opening it with lavish-view starts a relay again.
Missing/ambiguous targets or failed hc sends retain the outbox and post retarget
instructions on the page. Failed replies are logged (Working may remain);
startup/metadata failures fail the command, with the page already open.
Busy state locks fail after 120 seconds; retry after the send finishes.
Delivery is at-least-once: a crash after hc accepts a send but before the outbox
is cleared may replay it. Unsupported lavish-view-save/action tags reply visibly
without forwarding their payloads or changing files/actions. Missing sidecars
make retarget fail. Undecodable poll output is retained/forwarded raw for
inspection; NOT_FOUND stops without reopening. A crashed relay needs another
lavish-view open to restart. Logs use the first 16 SHA-256 hex digits of the
canonical page path. There is a small non-transactional gap between Lavish
consuming feedback and this process persisting it.

Diff range (default: jj fork_point(trunk() | @) to @; git: the working tree
against its merge base with origin/HEAD, origin/main, origin/master, main, or master):
  -r REV            jj revset, or A..B in git
  --from A --to B   diff between two revisions
  --git             use git even inside a jj repository
  -                 read a patch from stdin; --repo-root DIR sets the root for its paths
  --watch           keep running and refresh the page data when the diff changes
                    (not with -); run it as a background job and stop it after the review

Options:
  --title T         title under Artifacts (default: the page's <title>, then the file name)
  --out FILE        write the page to FILE; must be outside the reviewed repository
                    (default: under ~/.local/share/polytoken/artifacts/; an HTML
                    file is opened where it is)
  --open            open in the browser if registration under Artifacts fails or is unavailable
  --reopen          reopen a review the user ended in the browser`;
class UsageError extends Error {}

export function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const target = args.shift();
  if (!target || target.startsWith('-')) throw new UsageError();
  if (target === 'retarget') {
    const page = args.shift();
    if (!page || page.startsWith('-')) throw new UsageError('retarget requires a page file');
    if (args.length && (args.length !== 2 || args[0] !== '--terminal' || !args[1] || args[1].startsWith('-'))) throw new UsageError('retarget accepts only --terminal T');
    return { retarget: true, page, terminal: args[1] };
  }
  const diff = target === 'diff';
  const result = { target, diff };
  const values = new Map([['--title', 'title'], ['--out', 'out'], ...(diff ? [['-r', 'rev'], ['--from', 'from'], ['--to', 'to'], ['--repo-root', 'repoRoot']] : [])]);
  const switches = new Map([['--open', 'open'], ['--reopen', 'reopen'], ...(diff ? [['--watch', 'watch'], ['--git', 'git']] : [])]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (values.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new UsageError(`${arg} requires a value`);
      const key = values.get(arg); if (result[key] !== undefined) throw new UsageError(`${arg} given twice`); result[key] = args[++i];
    } else if (switches.has(arg)) {
      const key = switches.get(arg); if (result[key]) throw new UsageError(`${arg} given twice`); result[key] = true;
    } else if (diff && arg === '-' && !result.stdin) result.stdin = true;
    else throw new UsageError(`unknown argument ${arg}`);
  }
  if (diff && result.rev && (result.from || result.to)) throw new UsageError('-r conflicts with --from/--to');
  if (diff && Boolean(result.from) !== Boolean(result.to)) throw new UsageError('--from and --to must be given together');
  if (diff && result.repoRoot && !result.stdin) throw new UsageError('--repo-root requires a patch on stdin (lavish-view diff -)');
  if (diff && result.stdin && (result.watch || result.git || result.rev || result.from || result.to)) throw new UsageError('a patch on stdin conflicts with --watch, --git, -r, --from, and --to');
  return result;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs([...args]);
    if (options.help) { console.log(help); return 0; }
    if (options.retarget) {
      const result = await retarget(options.page, options.terminal, { log: message => console.error(`lavish-view: ${message}`) });
      console.log(`Retargeted ${result.target.page} to ${result.target.session || result.target.terminal}; delivered ${result.delivered} outbox batch(es).${result.pending ? ` ${result.pending} batch(es) remain in the outbox.` : ''}`);
      return result.pending ? 1 : 0;
    }
    let root;
    if (!options.diff) {
      const ext = path.extname(options.target).toLowerCase();
      if (!['.html', '.md', '.markdown'].includes(ext)) throw new UsageError(`${options.target}: expected a .html, .md, or .markdown file`);
      try { if (!(await stat(options.target)).isFile()) throw new UsageError(); } catch { throw new UsageError(`${options.target}: no such file`); }
      root = repoRoot(path.dirname(await realpath(options.target)));
    } else root = options.repoRoot ? repoRoot(path.resolve(options.repoRoot)) || path.resolve(options.repoRoot) : repoRoot(process.cwd());
    const source = options.diff ? await prepareDiff(options) : null;
    if (options.diff) await assertOutsideRepo(pagePath(source, options.out), source.root);
    else if (options.out) await assertOutsideRepo(options.out, root);
    else if (path.extname(options.target).toLowerCase() !== '.html') {
      await assertOutsideRepo(markdownOutputPath(await realpath(options.target)), root);
    }
    const deps = await ensureDeps();
    if (!options.diff && path.extname(options.target).toLowerCase() !== '.html') {
      const page = await writeMarkdown(options.target, deps, options);
      await openReview(page.file, { ...options, title: options.title ?? page.title });
      return 0;
    }
    if (options.diff) {
      let fingerprint = options.watch && source.kind === 'jj' ? await diffFingerprint(source) : null;
      const initial = await readDiff(source);
      let { file, patchHash } = await writeDiffPage(initial, deps.dist, options.out);
      await openReview(file, options);
      if (options.watch) {
        const tick = async () => {
          try {
            const nextFingerprint = source.kind === 'jj' ? await diffFingerprint(source) : null;
            if (source.kind === 'jj' && nextFingerprint === fingerprint) return;
            const data = await readDiff(source);
            const nextHash = createHash('sha256').update(data.patch).digest('hex');
            if (nextHash !== patchHash) ({ patchHash } = await writeDiffPage(data, deps.dist, options.out));
            fingerprint = nextFingerprint;
          } catch (error) { console.error(`lavish-view --watch: ${error.message} (still watching)`); }
        };
        while (true) { await new Promise(resolve => setTimeout(resolve, 3000)); await tick(); }
      }
      return 0;
    }
    if (!options.diff && path.extname(options.target).toLowerCase() === '.html') {
      const file = options.out ? path.resolve(options.out) : path.resolve(options.target);
      if (options.out) await atomicWrite(file, await readFile(options.target));
      await openReview(file, options);
      return 0;
    }
    throw new Error(`no renderer for ${options.target}`);
  } catch (error) {
    if (error instanceof UsageError || error instanceof DiffUsageError) { console.error(error.message ? `lavish-view: ${error.message}\n${usage}` : usage); return 2; }
    console.error(`lavish-view: ${error.message}`); return 1;
  }
}
