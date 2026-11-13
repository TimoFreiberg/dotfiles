import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, writeFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { decodeSave } from './save-message.mjs';

export const textHash = text => createHash('sha256').update(text).digest('hex');
const conflict = { reply: 'Conflict: the source file changed on disk. Nothing was saved. Use Reload (discard mine) or Keep mine before saving again.' };
export async function handleSave(prompt, target) {
  let temp;
  try {
    if (!target.sourceFile) throw new Error('this page has no recorded source file');
    const { baseHash, text } = decodeSave(prompt.prompt);
    const file = target.sourceFile;
    if (textHash(await readFile(file)) !== baseHash) return conflict;
    const { mode } = await stat(file);
    temp = path.join(path.dirname(file), `.lavish-view-${randomUUID()}.tmp`);
    await writeFile(temp, text, { flag: 'wx', mode: mode & 0o777 });
    await chmod(temp, mode & 0o777); // creation mode alone is filtered by umask
    // Recheck after preparing the replacement. Other writers do not share the
    // relay lock; POSIX rename has no compare-and-swap against their writes.
    if (textHash(await readFile(file)) !== baseHash) return conflict;
    await rename(temp, file);
    return { reply: 'Saved', notice: `The user edited ${file}. Read the updated source file before continuing.` };
  } catch (error) {
    return { reply: `Save failed: ${error.message}. Nothing was saved.` };
  } finally { if (temp) await rm(temp, { force: true }); }
}
