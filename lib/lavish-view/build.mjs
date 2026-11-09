import { createRequire } from 'node:module';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const [depsArg, outArg] = process.argv.slice(2);
if (!depsArg || !outArg) throw new Error('TODO(prose): build.mjs <deps> <out>');
const deps = path.resolve(depsArg), out = path.resolve(outArg);
const require = createRequire(path.join(deps, 'package.json'));
const esbuild = require('esbuild');
const worker = await esbuild.build({
  entryPoints: [path.join(deps, 'node_modules/@pierre/diffs/dist/worker/worker-portable.js')],
  bundle: true, format: 'iife', platform: 'browser', write: false,
  nodePaths: [path.join(deps, 'node_modules')], logLevel: 'silent',
});
await esbuild.build({
  entryPoints: [path.join(root, 'web/diff-app.mjs')],
  outfile: path.join(out, 'diff-app.js'), bundle: true, format: 'iife',
  platform: 'browser', splitting: false, nodePaths: [path.join(deps, 'node_modules')],
  define: { LAVISH_VIEW_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
  logLevel: 'silent',
});
await copyFile(path.join(root, 'web/diff.css'), path.join(out, 'diff.css'));
