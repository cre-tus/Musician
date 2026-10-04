export function toggleSidebarSessionSelection(selection, sessionId) {
  const next = new Set(selection);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return [...next];
}

export function selectSidebarSessionRange(selection, visibleIds, anchorId, targetId) {
  const anchorIndex = visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return toggleSidebarSessionSelection(selection, targetId);
  const next = new Set(selection);
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  for (const id of visibleIds.slice(start, end + 1)) next.add(id);
  return [...next];
}

export function selectVisibleSidebarSessions(selection, visibleIds, selected) {
  const next = new Set(selection);
  for (const id of visibleIds) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

export function visibleSidebarSessionSelection(selection, visibleIds) {
  const selected = new Set(selection);
  return visibleIds.filter((id) => selected.has(id));
}

export function allVisibleSidebarSessionsSelected(selection, visibleIds) {
  if (visibleIds.length === 0) return false;
  const selected = new Set(selection);
  return visibleIds.every((id) => selected.has(id));
}
