import { isSameOrDescendantPath } from './path-utils.mjs';

function sameLocation(left, right) {
  const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLocaleLowerCase();
  return normalizePath(left?.path) === normalizePath(right?.path) && left.line === right.line && left.column === right.column;
}

const MAX_HISTORY = 100;
const MAX_BOOKMARKS = 50;

export function editorNavigationStorageKey(folder) {
  const normalized = String(folder || '').replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
  return `mudex:editor-navigation-history:v1:${encodeURIComponent(normalized)}`;
}

export function readEditorNavigationHistory(folder, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const parsed = JSON.parse(target.getItem(editorNavigationStorageKey(folder)) || 'null');
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [], index: -1, bookmarks: [] };
    const valid = parsed.entries.filter((entry) => entry && typeof entry.path === 'string'
      && Number.isSafeInteger(entry.line) && entry.line > 0
      && Number.isSafeInteger(entry.column) && entry.column > 0).slice(-MAX_HISTORY);
    const bookmarks = (Array.isArray(parsed.bookmarks) ? parsed.bookmarks : []).filter((entry) => entry && typeof entry.path === 'string'
      && Number.isSafeInteger(entry.line) && entry.line > 0
      && Number.isSafeInteger(entry.column) && entry.column > 0).slice(-MAX_BOOKMARKS);
    if (!valid.length) return { entries: [], index: -1, bookmarks };
    const trimmed = parsed.entries.length - valid.length;
    const index = Number.isSafeInteger(parsed.index) ? parsed.index - trimmed : valid.length - 1;
    return { entries: valid, index: Math.max(-1, Math.min(valid.length - 1, index)), bookmarks };
  } catch {
    return { entries: [], index: -1, bookmarks: [] };
  }
}

export function writeEditorNavigationHistory(folder, history, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const entries = history.entries.slice(-MAX_HISTORY);
    const removed = history.entries.length - entries.length;
    const index = Math.max(-1, Math.min(entries.length - 1, history.index - removed));
    const bookmarks = (history.bookmarks || []).slice(-MAX_BOOKMARKS);
    target.setItem(editorNavigationStorageKey(folder), JSON.stringify({ entries, index, bookmarks }));
    return true;
  } catch {
    return false;
  }
}

export function toggleEditorLocationBookmark(bookmarks, location, limit = MAX_BOOKMARKS) {
  const existing = bookmarks.findIndex((entry) => sameLocation(entry, location));
  if (existing >= 0) return { bookmarks: bookmarks.filter((_, index) => index !== existing), bookmarked: false };
  return { bookmarks: [...bookmarks, location].slice(-limit), bookmarked: true };
}

export function pushEditorLocation(entries, index, location, limit = 100) {
  if (index >= 0 && sameLocation(entries[index], location)) return { entries, index };
  const next = entries.slice(0, Math.max(0, Math.min(entries.length, index + 1)));
  if (sameLocation(next[next.length - 1], location)) {
    return { entries: next, index: next.length - 1 };
  }
  next.push(location);
  if (next.length > limit) next.splice(0, next.length - limit);
  return { entries: next, index: next.length - 1 };
}

export function stepEditorLocation(entries, index, direction) {
  if (index < 0) return { index, location: null };
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= entries.length) return { index, location: null };
  return { index: nextIndex, location: entries[nextIndex] };
}

function replaceLocationPathPrefix(value, oldPrefix, newPrefix) {
  const suffix = String(value).slice(String(oldPrefix).length).replace(/^[\\/]+/, '');
  if (!suffix) return newPrefix;
  const separator = String(newPrefix).includes('\\') ? '\\' : '/';
  return `${newPrefix}${String(newPrefix).endsWith('\\') || String(newPrefix).endsWith('/') ? '' : separator}${suffix}`;
}

// Rename: remap history entries and bookmarks under oldPath, like recent
// files and closed tabs. Lengths are unchanged so the index stays valid.
export function remapEditorNavigationPaths(history, oldPath, newPath) {
  const mapLocation = (location) => {
    if (!location || typeof location !== 'object') return location;
    if (!isSameOrDescendantPath(oldPath, location.path)) return location;
    return { ...location, path: replaceLocationPathPrefix(location.path, oldPath, newPath) };
  };
  return {
    entries: (history.entries || []).map(mapLocation),
    index: history.index,
    bookmarks: (history.bookmarks || []).map(mapLocation),
  };
}

// Delete: drop history entries and bookmarks under removedPath and clamp
// the index into the surviving entries.
export function removeEditorNavigationPaths(history, removedPath) {
  const entries = (history.entries || []).filter((location) => {
    if (!location || typeof location !== 'object') return true;
    return !isSameOrDescendantPath(removedPath, location.path);
  });
  const bookmarks = (history.bookmarks || []).filter((location) => {
    if (!location || typeof location !== 'object') return true;
    return !isSameOrDescendantPath(removedPath, location.path);
  });
  return { entries, index: Math.max(-1, Math.min(history.index, entries.length - 1)), bookmarks };
}
