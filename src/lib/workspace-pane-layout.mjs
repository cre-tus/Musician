import { normalizePathForComparison } from './path-utils.mjs';

const LEGACY_KEY = 'mudex:pane-layout:v1';

export function workspacePaneLayoutKey(folder) {
  const normalized = normalizePathForComparison(folder);
  return normalized ? `${LEGACY_KEY}:${encodeURIComponent(normalized)}` : LEGACY_KEY;
}

export function serializeWorkspacePaneLayout(folder, tabs, activeTabId) {
  const savedTabs = [];
  for (const tab of Array.isArray(tabs) ? tabs.slice(-40) : []) {
    if (!tab || typeof tab.id !== 'string' || typeof tab.title !== 'string') continue;
    if (tab.kind === 'file') {
      if (!tab.file || tab.file.readOnly) continue;
      savedTabs.push({ id: tab.id, kind: tab.kind, title: tab.title, ...(tab.pinned ? { pinned: true } : {}), file: { path: tab.file.path } });
      continue;
    }
    if (['files', 'browser', 'terminal'].includes(tab.kind)) {
      savedTabs.push({
        id: tab.id,
        kind: tab.kind,
        title: tab.title,
        ...(typeof tab.url === 'string' ? { url: tab.url } : {}),
        ...(tab.shell === 'cmd' || tab.shell === 'powershell' ? { shell: tab.shell } : {}),
        ...(typeof tab.cwd === 'string' ? { cwd: tab.cwd } : {}),
      });
    }
  }
  return { version: 1, folder: String(folder || ''), tabs: savedTabs, activeTabId: String(activeTabId || '') };
}

export function mergeLiveWorkspaceTabs(restoredTabs, liveTabs) {
  const result = Array.isArray(restoredTabs) ? [...restoredTabs] : [];
  for (const tab of Array.isArray(liveTabs) ? liveTabs : []) {
    if (!tab || (tab.kind !== 'terminal' && tab.kind !== 'browser')) continue;
    const index = result.findIndex((candidate) => candidate.id === tab.id);
    if (index >= 0) result[index] = tab;
    else result.push(tab);
  }
  return result;
}

export function readWorkspacePaneLayout(folder, storage) {
  try {
    const target = storage || globalThis.localStorage;
    const scoped = target?.getItem(workspacePaneLayoutKey(folder));
    const raw = scoped || target?.getItem(LEGACY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    if (parsed.folder && normalizePathForComparison(parsed.folder) !== normalizePathForComparison(folder)) return null;
    const legacyFolder = !parsed.folder ? target?.getItem('mudex:folder:v1') : '';
    if (legacyFolder && normalizePathForComparison(legacyFolder) !== normalizePathForComparison(folder)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWorkspacePaneLayout(folder, tabs, activeTabId, storage) {
  try {
    const target = storage || globalThis.localStorage;
    const layout = serializeWorkspacePaneLayout(folder, tabs, activeTabId);
    target?.setItem(workspacePaneLayoutKey(folder), JSON.stringify(layout));
    if (folder) target?.setItem(LEGACY_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function removeTabFromStoredWorkspaceLayouts(tabId, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target || typeof tabId !== 'string' || !tabId) return false;
    const length = typeof target.length === 'number' ? target.length : 0;
    const keys = [];
    for (let i = 0; i < length; i++) {
      const key = typeof target.key === 'function' ? target.key(i) : null;
      if (key === LEGACY_KEY || (typeof key === 'string' && key.startsWith(`${LEGACY_KEY}:`))) keys.push(key);
    }
    let removed = false;
    for (const key of keys) {
      let parsed = null;
      try {
        parsed = JSON.parse(target.getItem(key) || 'null');
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.tabs)) continue;
      const next = parsed.tabs.filter((tab) => !tab || tab.id !== tabId);
      if (next.length === parsed.tabs.length) continue;
      parsed.tabs = next;
      target.setItem(key, JSON.stringify(parsed));
      removed = true;
    }
    return removed;
  } catch {
    return false;
  }
}
