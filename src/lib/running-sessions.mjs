// Rows for the running strip above the chat thread: every running
// session, active first, the rest in session order.
export function visibleRunningSessions(sessions, runningIds, activeId) {
  if (!Array.isArray(sessions) || !Array.isArray(runningIds)) return [];
  const live = new Set(runningIds.filter((id) => typeof id === 'string'));
  const rows = [];
  for (const session of sessions) {
    if (!session || typeof session !== 'object') continue;
    if (typeof session.id !== 'string' || !live.has(session.id)) continue;
    rows.push({
      id: session.id,
      title: typeof session.title === 'string' ? session.title : '',
      current: session.id === activeId,
    });
  }
  rows.sort((a, b) => Number(b.current) - Number(a.current));
  return rows;
}
