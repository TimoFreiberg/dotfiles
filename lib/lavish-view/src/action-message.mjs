import { decodeSave, encodeSave } from './save-message.mjs';

export const actionTag = 'lavish-view-action';
const prefix = 'lavish-view-action/v1\n';
export function encodeCreatePR(baseHash, text) {
  return prefix + JSON.stringify({ action: 'create-pr', save: encodeSave(baseHash, text) });
}
export function decodeAction(prompt) {
  if (typeof prompt !== 'string' || !prompt.startsWith(prefix)) throw new Error('unrecognized action message');
  const data = JSON.parse(prompt.slice(prefix.length));
  if (data?.action !== 'create-pr') throw new Error('unsupported action');
  decodeSave(data.save);
  return data;
}
