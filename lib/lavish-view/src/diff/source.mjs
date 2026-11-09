import { spawn } from 'node:child_process';
import path from 'node:path';

export class DiffUsageError extends Error {}

function run(command, args, cwd, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const stdout = Buffer.concat(output).toString('utf8'), stderr = Buffer.concat(errors).toString('utf8');
      if (code && !allowFailure) reject(new Error(`${command}: ${stderr.trim() || `exit ${code}`}`));
      else resolve({ code, stdout, stderr });
    });
  });
}
const candidates = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
const jjConfig = ['--config', 'diff.git.show-path-prefix=true'];
const jjTemplate = 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ description.first_line() ++ "\\n"';

export async function prepareDiff(options, cwd = process.cwd()) {
  if (options.stdin) {
    if (options.watch || options.git || options.rev || options.from || options.to) throw new DiffUsageError('TODO(prose): stdin conflicts with diff options');
    return { kind: 'stdin', root: path.resolve(options.repoRoot || cwd), range: 'stdin', rangeSource: 'stdin', rangeSpec: 'stdin', revision: null };
  }
  if (options.repoRoot) throw new DiffUsageError('TODO(prose): --repo-root requires stdin');
  if (options.rev && (options.from || options.to)) throw new DiffUsageError('TODO(prose): -r conflicts with --from/--to');
  if (Boolean(options.from) !== Boolean(options.to)) throw new DiffUsageError('TODO(prose): --from and --to must be paired');
  const jj = options.git ? null : await run('jj', ['root'], cwd, { allowFailure: true }).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (jj && jj.code === 0) {
    const root = jj.stdout.trim();
    const from = options.from || 'fork_point(trunk() | @)', to = options.to || '@';
    const rangeArgs = options.rev ? ['-r', options.rev] : ['--from', from, '--to', to];
    const logRev = options.rev || `${from}..${to}`;
    return { kind: 'jj', root, rangeArgs, logRev, to: options.rev ? null : to, range: options.rev || `${from} → ${to}`, rangeSource: options.rev ? `-r ${options.rev}` : options.from ? `--from ${from} --to ${to}` : 'default: branch vs trunk', rangeSpec: options.rev ? `-r ${options.rev}` : `${from}..${to}` };
  }
  const rootResult = await run('git', ['rev-parse', '--show-toplevel'], cwd, { allowFailure: true });
  if (rootResult.code) throw new DiffUsageError('TODO(prose): not in a jj or git repository');
  const root = rootResult.stdout.trim();
  if (options.rev && !options.rev.includes('..')) throw new DiffUsageError('TODO(prose): git -r requires A..B');
  let diffArgs, range, rangeSource, to;
  if (options.rev) { diffArgs = [options.rev]; range = options.rev; rangeSource = `-r ${options.rev}`; to = options.rev.split('..').at(-1); }
  else if (options.from) { diffArgs = [options.from, options.to]; range = `${options.from} → ${options.to}`; rangeSource = `--from ${options.from} --to ${options.to}`; to = options.to; }
  else {
    for (const candidate of candidates) {
      const result = await run('git', ['merge-base', candidate, 'HEAD'], root, { allowFailure: true });
      if (!result.code) { diffArgs = [result.stdout.trim()]; range = `${candidate} → working tree`; rangeSource = `default: merge-base ${candidate}`; break; }
    }
    if (!diffArgs) throw new DiffUsageError(`TODO(prose): no git merge base; tried ${candidates.join(', ')}`);
  }
  const logRange = options.rev || (options.from ? `${options.from}..${options.to}` : `${diffArgs[0]}..HEAD`);
  return { kind: 'git', root, diffArgs, to, logRange, range, rangeSource, rangeSpec: rangeSource };
}

export async function diffFingerprint(source) {
  if (source.kind !== 'jj') return null;
  return (await run('jj', [...jjConfig, 'log', '-r', source.logRev, '--no-graph', '-T', 'commit_id ++ "\\n"'], source.root)).stdout;
}

export async function readDiff(source, stdin = process.stdin) {
  if (source.kind === 'stdin') {
    const chunks = []; for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return { ...source, patch: Buffer.concat(chunks).toString('utf8'), commits: [], generated: new Date().toISOString() };
  }
  if (source.kind === 'jj') {
    const [patch, commits, revision] = await Promise.all([
      run('jj', [...jjConfig, 'diff', '--git', ...source.rangeArgs], source.root),
      run('jj', [...jjConfig, 'log', '-r', source.logRev, '--no-graph', '-T', jjTemplate], source.root),
      source.to ? run('jj', ['log', '-r', source.to, '--no-graph', '-T', 'commit_id'], source.root, { allowFailure: true }) : Promise.resolve({ code: 1 }),
    ]);
    return { ...source, patch: patch.stdout, commits: commits.stdout.trim().split('\n').filter(Boolean), revision: revision.code ? null : revision.stdout.trim(), generated: new Date().toISOString() };
  }
  const [patch, revision, commits] = await Promise.all([
    run('git', ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', ...source.diffArgs], source.root),
    source.to ? run('git', ['rev-parse', '--verify', `${source.to}^{commit}`], source.root, { allowFailure: true }) : Promise.resolve({ code: 1 }),
    run('git', ['log', '--oneline', source.logRange], source.root, { allowFailure: true }),
  ]);
  return { ...source, patch: patch.stdout, commits: commits.code ? [] : commits.stdout.trim().split('\n').filter(Boolean), revision: revision.code ? null : revision.stdout.trim(), generated: new Date().toISOString() };
}
