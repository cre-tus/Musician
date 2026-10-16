// Per-conversation composer attachments: persist descriptors across
// session switches and reloads, re-reading text content live so restores
// never serve stale bytes. Pasted images cannot be re-read and are dropped
// with a notice. Also: outside-folder detection for cross-project tags.
// Exit 0 = ALL PASS (see composer-drafts-test.mjs).
export const ATTACH_DRAFT_MAX = 20;

export function attachDraftKey(sessionId) {
  return `mudex:attach-draft:${String(sessionId || '')}`;
}

function cleanDescriptor(e) {
  if (!e || typeof e !== 'object') return null;
  const p = String(e.path || '');
  const name = String(e.name || '');
  if (!p || !name) return null;
  return {
    path: p.slice(0, 1000),
    name: name.slice(0, 200),
    image: e.image === true,
    folder: e.folder === true,
  };
}

export function saveAttachDraft(storage, sessionId, list) {
  try {
    if (!storage || !sessionId || !Array.isArray(list)) return false;
    const clean = [];
    let images = 0;
    for (const e of list) {
      if (e && e.image) {
        images += 1;
        continue; // pasted images cannot be restored
      }
      const d = cleanDescriptor(e);
      if (d) clean.push(d);
      if (clean.length >= ATTACH_DRAFT_MAX) break;
    }
    if (clean.length === 0 && images === 0) storage.removeItem(attachDraftKey(sessionId));
    else storage.setItem(attachDraftKey(sessionId), JSON.stringify({ v: 1, files: clean, images }));
    return true;
  } catch {
    return false;
  }
}

export function loadAttachDraft(storage, sessionId) {
  try {
    if (!storage || !sessionId) return { kept: [], droppedImages: false };
    const raw = storage.getItem(attachDraftKey(sessionId));
    if (!raw) return { kept: [], droppedImages: false };
    const data = JSON.parse(raw);
    const files = Array.isArray(data) ? data : data && Array.isArray(data.files) ? data.files : null;
    if (!files) return { kept: [], droppedImages: false };
    const kept = [];
    for (const e of files) {
      const d = cleanDescriptor(e);
      if (d && !d.image) kept.push(d);
      if (kept.length >= ATTACH_DRAFT_MAX) break;
    }
    const droppedImages = !Array.isArray(data) && data && typeof data.images === 'number' ? data.images > 0 : false;
    return { kept, droppedImages };
  } catch {
    return { kept: [], droppedImages: false };
  }
}

export function clearAttachDraft(storage, sessionId) {
  try {
    if (!storage || !sessionId) return;
    storage.removeItem(attachDraftKey(sessionId));
  } catch {
    /* best-effort */
  }
}

// True when absPath lives outside dir (a cross-project attachment).
export function isOutsideDir(absPath, dir) {
  const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const p = norm(absPath);
  const d = norm(dir);
  if (!p || !d) return false;
  return p !== d && !p.startsWith(`${d}/`);
}
