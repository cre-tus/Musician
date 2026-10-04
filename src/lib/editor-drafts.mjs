const STORAGE_KEY = 'mudex:editor-drafts:v1';
const MAX_FILE_CHARS = 700_000;
const MAX_TOTAL_CHARS = 1_500_000;

function storageKey(scope) {
  const normalized = normalizeDraftPath(scope);
  return normalized ? `${STORAGE_KEY}:${encodeURIComponent(normalized)}` : STORAGE_KEY;
}

function normalizeDraftPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function editorDraftStorageKey(scope) {
  return storageKey(scope);
}

export function hashEditorText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function readEditorDrafts(storage, scope = '') {
  try {
    const target = storage || globalThis.sessionStorage;
    const scopedKey = storageKey(scope);
    const scopedRaw = target.getItem(scopedKey);
    const migratingLegacy = !!scope && !scopedRaw;
    const parsed = JSON.parse(scopedRaw || (migratingLegacy ? target.getItem(STORAGE_KEY) : null) || 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.drafts)) return [];
    const root = normalizeDraftPath(scope);
    return parsed.drafts.filter((draft) => draft
      && typeof draft.path === 'string'
      && typeof draft.original === 'string'
      && typeof draft.content === 'string'
      && typeof draft.originalHash === 'string'
      && draft.original.length <= MAX_FILE_CHARS
      && draft.content.length <= MAX_FILE_CHARS
      && hashEditorText(draft.original) === draft.originalHash
      && (!migratingLegacy || !root || normalizeDraftPath(draft.path) === root || normalizeDraftPath(draft.path).startsWith(`${root}/`)));
  } catch {
    return [];
  }
}

export function writeEditorDrafts(tabs, activeTabId, storage, scope = '') {
  const candidates = tabs
    .filter((tab) => tab.kind === 'file' && tab.file && tab.file.dirty && !tab.file.readOnly)
    .sort((a, b) => Number(b.id === activeTabId) - Number(a.id === activeTabId));
  const drafts = [];
  let totalChars = 0;
  for (const tab of candidates) {
    const original = tab.file.original;
    const content = tab.file.content;
    const size = original.length + content.length;
    if (original.length > MAX_FILE_CHARS || content.length > MAX_FILE_CHARS || totalChars + size > MAX_TOTAL_CHARS) continue;
    drafts.push({ path: tab.file.path, original, content, originalHash: hashEditorText(original) });
    totalChars += size;
  }

  try {
    const target = storage || globalThis.sessionStorage;
    const key = storageKey(scope);
    if (drafts.length === 0 && scope) target.setItem(key, JSON.stringify({ version: 1, drafts: [] }));
    else if (drafts.length === 0) target.removeItem(key);
    else target.setItem(key, JSON.stringify({ version: 1, drafts }));
    return { savedCount: drafts.length, omittedCount: candidates.length - drafts.length };
  } catch {
    return { savedCount: 0, omittedCount: candidates.length };
  }
}

export function findEditorDraft(drafts, filePath) {
  const target = normalizeDraftPath(filePath);
  return drafts.find((draft) => normalizeDraftPath(draft.path) === target) || null;
}

export function restoreEditorDraft(diskContent, draft) {
  if (!draft) return { original: diskContent, content: diskContent, dirty: false, diskChanged: false };
  const alreadyOnDisk = draft.content === diskContent;
  const diskChanged = !alreadyOnDisk && hashEditorText(diskContent) !== draft.originalHash;
  return {
    original: alreadyOnDisk ? diskContent : draft.original,
    content: draft.content,
    dirty: !alreadyOnDisk && draft.content !== draft.original,
    diskChanged,
  };
}
