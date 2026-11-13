import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, writeFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { decodeSave, validateSave } from './save-message.mjs';

export const textHash = text => createHash('sha256').update(text).digest('hex');
const conflict = { reply: 'Conflict: the source file changed on disk. Nothing was saved. Use Reload (discard mine) or Keep mine before saving again.' };
export async function handleSave(prompt, target, options) {
  try { return await saveDocument(decodeSave(prompt.prompt), target, options); }
  catch (error) { return { reply: `Save failed: ${error.message}. Nothing was saved.` }; }
}
export async function saveDocument(data, target, { recovering = false } = {}) {
  let temp;
  const interrupted = detail => ({
    reply: `Interrupted save: ${detail}. An earlier replacement may have succeeded. No new write was made. Inspect the source, then use Reload (discard mine) or Keep mine before saving again.`,
    ...(target.sourceFile ? { notice: `A user save of ${target.sourceFile} was interrupted and its outcome cannot be verified. Read the source file before continuing.` } : {}),
  });
  const mismatch = () => recovering ? interrupted('the disk no longer matches the original or requested text') : conflict;
  try {
    if (!target.sourceFile) throw new Error('this page has no recorded source file');
    const { baseHash, text } = validateSave(data);
    const file = target.sourceFile, savedHash = textHash(text);
    const saved = { reply: 'Saved', notice: `The user edited ${file}. Read the updated source file before continuing.` };
    const diskHash = textHash(await readFile(file));
    // A durable pending batch may resume after rename but before its result was
    // recorded. Matching the requested bytes makes that retry idempotent.
    if (diskHash === savedHash) return saved;
    if (diskHash !== baseHash) return mismatch();
    const { mode } = await stat(file);
    temp = path.join(path.dirname(file), `.lavish-view-${randomUUID()}.tmp`);
    await writeFile(temp, text, { flag: 'wx', mode: mode & 0o777 });
    await chmod(temp, mode & 0o777); // creation mode alone is filtered by umask
    // Other writers do not share the relay lock; POSIX rename has no
    // compare-and-swap against their writes.
    const currentHash = textHash(await readFile(file));
    if (currentHash === savedHash) return saved;
    if (currentHash !== baseHash) return mismatch();
    await rename(temp, file);
    return saved;
  } catch (error) {
    return recovering ? interrupted(error.message) : { reply: `Save failed: ${error.message}. Nothing was saved.` };
  } finally { if (temp) await rm(temp, { force: true }); }
}
