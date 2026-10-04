const STORAGE_KEY = 'mudex:hidden-host-sessions:v1';

function storageTarget(storage) {
  try {
    return storage || globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readHiddenHostSessionIds(storage) {
  try {
    const raw = storageTarget(storage)?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function hideHostSessionId(id, storage) {
  if (!id) return readHiddenHostSessionIds(storage);
  const next = [...new Set([...readHiddenHostSessionIds(storage), String(id)])];
  try {
    storageTarget(storage)?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Dismiss stays in-memory when preference storage is unavailable.
  }
  return next;
}

export function visibleHostSessions(list, hiddenIds) {
  const hidden = new Set(hiddenIds || []);
  return (list || []).filter((h) => h && !hidden.has(h.sessionId));
}

export function hostSessionDateStrings(session) {
  const raw = session?.updatedAt;
  if (!raw) return [];
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return [];
  const date = new Date(time);
  const iso = date.toISOString().slice(0, 10);
  const locale = date.toLocaleDateString('ko-KR');
  const localeTime = date.toLocaleString('ko-KR');
  return [iso, locale, localeTime];
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

export function matchesHostSessionQuery(session, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (!session) return false;
  const haystack = [
    session.title,
    session.name,
    session.sessionId,
    session.workspaceRoot,
    baseName(session.workspaceRoot),
    session.modelId,
    ...hostSessionDateStrings(session),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(q);
}

export function filterHostSessions(list, query, hiddenIds) {
  const q = String(query || '').trim().toLowerCase();
  return visibleHostSessions(list, hiddenIds).filter((h) => (q ? matchesHostSessionQuery(h, q) : true));
}
