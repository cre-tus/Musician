export function unpinnedPaneTabIds(tabs) {
  return tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
}

export function ensureFilesTabFallback(tabs, createFilesTab) {
  if (Array.isArray(tabs) && tabs.length > 0) return tabs;
  return [createFilesTab()];
}
