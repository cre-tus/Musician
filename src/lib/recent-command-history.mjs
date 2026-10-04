const STORAGE_KEY = 'mudex:recent-commands:v1';

export function normalizeRecentCommandIds(value, limit = 8) {
  if (!Array.isArray(value) || !Number.isInteger(limit) || limit <= 0) return [];
  const seen = new Set();
  const ids = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim() || id.length > 240 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function recordRecentCommand(ids, id, limit = 8) {
  if (typeof id !== 'string' || !id.trim() || id.length > 240 || !Number.isInteger(limit) || limit <= 0) {
    return normalizeRecentCommandIds(ids, limit);
  }
  return normalizeRecentCommandIds([id, ...(Array.isArray(ids) ? ids : [])], limit);
}

export function readRecentCommandIds(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return normalizeRecentCommandIds(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeRecentCommandIds(ids, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, JSON.stringify(normalizeRecentCommandIds(ids)));
  } catch {
    // Command history is a convenience; palette actions remain available if storage is unavailable.
  }
}
