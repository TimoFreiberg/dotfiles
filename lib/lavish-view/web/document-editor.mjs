import { encodeSave, saveTag } from '../src/save-message.mjs';

// getText/setText let other document forms use the same save/watch decisions.
export function createDocumentEditor({ getText, setText, changed, status, normalizeText = text => text.replace(/\r\n?/g, '\n') }) {
  let disk, baseline = '', pending;
  const dirty = () => getText() !== baseline;
  const update = data => {
    if (disk?.hash === data.hash) {
      pending = null; changed(false);
      status(dirty() ? 'Unsaved edits' : 'Up to date with disk');
      return;
    }
    const mine = getText();
    if (!disk || !dirty() || mine === data.text) {
      setText(data.text); baseline = getText(); disk = data; pending = null;
      changed(false); status('Up to date with disk');
    } else {
      pending = data;
      changed(true);
      status('Disk changed; your unsaved edits are kept');
    }
  };
  const reload = () => {
    if (!pending) return;
    setText(pending.text); baseline = getText(); disk = pending; pending = null;
    changed(false); status('Reloaded from disk');
  };
  const keep = () => {
    if (!pending) return;
    disk = pending; baseline = normalizeText(disk.text); pending = null; changed(false);
    status('Kept your edits; next Save uses the new disk hash');
  };
  const save = () => {
    if (!disk) { status('Waiting for the source file'); return; }
    if (pending) { status('Choose Reload (discard mine) or Keep mine before saving'); return; }
    if (typeof window.lavish?.queuePrompt !== 'function' || typeof window.lavish?.sendQueuedPrompts !== 'function') {
      status('Save unavailable: open this page in Lavish'); return;
    }
    try {
      window.lavish.queuePrompt(encodeSave(disk.hash, getText()), { tag: saveTag, text: 'Save document' });
      window.lavish.sendQueuedPrompts();
      status('Save sent; check the Lavish reply for Saved or a conflict. Edits stay here until disk updates.');
    } catch (error) { status(`Save failed to send: ${error.message}. Your edits are kept.`); }
  };
  return { update, reload, keep, save, dirty };
}

// Like the diff page, use scripts so this also works in Lavish's file-backed iframe.
export function watchDocumentData(update, status) {
  let latest, loaded, loading;
  function script(src, done, fail) {
    const node = document.createElement('script'); node.src = src;
    node.onload = () => { node.remove(); done?.(); };
    node.onerror = () => { node.remove(); fail?.(); };
    document.head.append(node);
  }
  const load = () => {
    if (!latest || loading || latest === loaded) return;
    const hash = loading = latest;
    script(`./data-${encodeURIComponent(hash)}.js?t=${Date.now()}`, () => { loading = null; load(); }, () => { loading = null; status('Could not load the disk update; retrying'); });
  };
  globalThis.lavishViewLatest = hash => { if (!/^[a-f0-9]{64}$/.test(hash)) return; latest = hash; load(); };
  globalThis.lavishViewData = data => { if (data.hash !== loading) return; loaded = data.hash; update(data); };
  const poll = () => script(`./latest.js?t=${Date.now()}`, null, () => status('Could not check disk updates; retrying'));
  poll(); const timer = setInterval(poll, 1000);
  return () => clearInterval(timer);
}
