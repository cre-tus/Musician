export const EXPLORER_SECTIONS = ['open', 'pinned', 'recent', 'changed'];

export function explorerSectionStorageKey(folder) {
  const normalized = String(folder || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return `mudex:explorer-sections:v1:${encodeURIComponent(normalized)}`;
}

export function readExplorerSectionState(folder, storage) {
  const fallback = { open: true, pinned: true, recent: true, changed: true };
  if (!folder) return { ...fallback };
  try {
    const target = storage ?? globalThis.localStorage;
    const parsed = JSON.parse(target.getItem(explorerSectionStorageKey(folder)) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...fallback };
    return {
      open: parsed.open !== false,
      pinned: parsed.pinned !== false,
      recent: parsed.recent !== false,
      changed: parsed.changed !== false,
    };
  } catch {
    return { ...fallback };
  }
}

export function writeExplorerSectionState(folder, state, storage) {
  if (!folder) return false;
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(explorerSectionStorageKey(folder), JSON.stringify({
      open: state.open !== false,
      pinned: state.pinned !== false,
      recent: state.recent !== false,
      changed: state.changed !== false,
    }));
    return true;
  } catch {
    return false;
  }
}

export function toggleExplorerSection(state, section) {
  if (!EXPLORER_SECTIONS.includes(section)) return state;
  return { ...state, [section]: !(state[section] !== false) };
}
