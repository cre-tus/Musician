import { normalizePinnedFilePath } from './pinned-file-paths.mjs';

const STORAGE_PREFIX = 'mudex:file-search-history:v1:';
const HISTORY_LIMIT = 8;

export function fileSearchHistoryKey(folder) {
  return `${STORAGE_PREFIX}${normalizePinnedFilePath(folder)}`;
}

export function normalizeFileSearchHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const history = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const query = typeof entry.query === 'string' ? entry.query.trim().slice(0, 240) : '';
    const mode = entry.mode === 'content' ? 'content' : entry.mode === 'name' ? 'name' : null;
    const identity = `${mode || ''}\0${query.toLocaleLowerCase()}`;
    if (!query || !mode || seen.has(identity)) continue;
    seen.add(identity);
    history.push({ query, mode });
    if (history.length >= HISTORY_LIMIT) break;
  }
  return history;
}

export function recordFileSearchQuery(history, query, mode) {
  if (mode !== 'name' && mode !== 'content') return normalizeFileSearchHistory(history);
  const entry = { query: String(query || '').trim().slice(0, 240), mode };
  if (!entry.query) return normalizeFileSearchHistory(history);
  return normalizeFileSearchHistory([entry, ...(Array.isArray(history) ? history : [])]);
}

export function readFileSearchHistory(folder, storage) {
  if (!folder) return [];
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(fileSearchHistoryKey(folder));
    return normalizeFileSearchHistory(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeFileSearchHistory(folder, history, storage) {
  if (!folder) return false;
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(fileSearchHistoryKey(folder), JSON.stringify(normalizeFileSearchHistory(history)));
    return !!target;
  } catch {
    return false;
  }
}
