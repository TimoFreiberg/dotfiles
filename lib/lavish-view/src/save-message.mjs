// Shared by the browser editor and relay. No path is accepted from the page.
export const saveTag = 'lavish-view-save';
const prefix = 'lavish-view-save/v1\n';
export function encodeSave(baseHash, text) {
  return prefix + JSON.stringify({ baseHash, text });
}
export function decodeSave(prompt) {
  if (typeof prompt !== 'string' || !prompt.startsWith(prefix)) throw new Error('unrecognized save message');
  const data = JSON.parse(prompt.slice(prefix.length));
  return validateSave(data);
}
export function validateSave(data) {
  if (!data || typeof data.text !== 'string' || typeof data.baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.baseHash)) throw new Error('invalid save text or disk hash');
  return data;
}
