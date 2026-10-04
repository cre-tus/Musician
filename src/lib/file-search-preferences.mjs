import { normalizePinnedFilePath } from './pinned-file-paths.mjs';

const STORAGE_PREFIX = 'mudex:file-search-preferences:v1:';

export function defaultFileSearchPreferences() {
  return { include: '', exclude: '', caseSensitive: false, wholeWord: false, filtersOpen: false };
}

export function fileSearchPreferencesKey(folder) {
  return `${STORAGE_PREFIX}${normalizePinnedFilePath(folder)}`;
}

function normalizePreferences(value) {
  const defaults = defaultFileSearchPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  return {
    include: typeof value.include === 'string' ? value.include.slice(0, 1000) : defaults.include,
    exclude: typeof value.exclude === 'string' ? value.exclude.slice(0, 1000) : defaults.exclude,
    caseSensitive: value.caseSensitive === true,
    wholeWord: value.wholeWord === true,
    filtersOpen: value.filtersOpen === true,
  };
}

export function readFileSearchPreferences(folder, storage) {
  if (!folder) return defaultFileSearchPreferences();
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(fileSearchPreferencesKey(folder));
    return normalizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultFileSearchPreferences();
  }
}

export function writeFileSearchPreferences(folder, value, storage) {
  if (!folder) return false;
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(fileSearchPreferencesKey(folder), JSON.stringify(normalizePreferences(value)));
    return !!target;
  } catch {
    return false;
  }
}
