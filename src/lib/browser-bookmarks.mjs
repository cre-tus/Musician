const STORAGE_KEY = 'mudex:browser-bookmarks:v1';

export const MAX_BROWSER_BOOKMARKS = 100;

export function normalizeBookmarkUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    return new URL(s).href;
  } catch {
    return '';
  }
}

export function bookmarkHost(url) {
  try {
    return new URL(String(url || '').trim()).host || '';
  } catch {
    return '';
  }
}

function cleanBookmark(row) {
  if (!row || typeof row !== 'object') return null;
  const url = normalizeBookmarkUrl(row.url);
  if (!url) return null;
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : bookmarkHost(url);
  const createdAt = Number.isFinite(row.createdAt) ? row.createdAt : Date.now();
  return { url, title, createdAt };
}

export function normalizeBrowserBookmarks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const row of value) {
    const cleaned = cleanBookmark(row);
    if (!cleaned || seen.has(cleaned.url)) continue;
    seen.add(cleaned.url);
    out.push(cleaned);
    if (out.length >= MAX_BROWSER_BOOKMARKS) break;
  }
  return out;
}

export function isBrowserBookmarked(list, url) {
  const canonical = normalizeBookmarkUrl(url);
  if (!canonical) return false;
  return normalizeBrowserBookmarks(list).some((row) => row.url === canonical);
}

export function toggleBrowserBookmark(list, url, title, now) {
  const current = normalizeBrowserBookmarks(list);
  const canonical = normalizeBookmarkUrl(url);
  if (!canonical) return current;
  if (current.some((row) => row.url === canonical)) return current.filter((row) => row.url !== canonical);
  const at = Number.isFinite(now) ? now : Date.now();
  const name = typeof title === 'string' && title.trim() ? title.trim() : bookmarkHost(canonical);
  return normalizeBrowserBookmarks([{ url: canonical, title: name, createdAt: at }, ...current]);
}

export function removeBrowserBookmark(list, url) {
  const current = normalizeBrowserBookmarks(list);
  const canonical = normalizeBookmarkUrl(url);
  if (!canonical) return current;
  return current.filter((row) => row.url !== canonical);
}

export function readBrowserBookmarks(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return normalizeBrowserBookmarks(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeBrowserBookmarks(list, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, JSON.stringify(normalizeBrowserBookmarks(list)));
  } catch {
    // Bookmarks are a convenience; the browser keeps working if storage is unavailable.
  }
}
