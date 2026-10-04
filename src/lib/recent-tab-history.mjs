export function touchRecentTab(history, activeId, openIds) {
  const open = openIds instanceof Set ? openIds : new Set(openIds);
  return [
    ...(activeId && open.has(activeId) ? [activeId] : []),
    ...history.filter((id) => open.has(id) && id !== activeId),
  ];
}

export function nextRecentTab(history, activeId, openIds, direction = 1) {
  const open = openIds instanceof Set ? openIds : new Set(openIds);
  const candidates = history.filter((id) => open.has(id) && id !== activeId);
  return direction > 0 ? candidates[0] || null : candidates[candidates.length - 1] || null;
}
