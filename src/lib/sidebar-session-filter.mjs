const STORAGE_KEY = 'mudex:sidebar-session-filter:v1';
const FILTERS = new Set(['all', 'pinned', 'running', 'failed', 'draft', 'queued']);

export function normalizeSidebarSessionFilter(value) {
  return FILTERS.has(value) ? value : 'all';
}

export function readSidebarSessionFilter(storage) {
  try {
    const target = storage || globalThis.localStorage;
    return normalizeSidebarSessionFilter(target?.getItem(STORAGE_KEY));
  } catch {
    return 'all';
  }
}

export function writeSidebarSessionFilter(value, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, normalizeSidebarSessionFilter(value));
  } catch {
    // Filtering remains usable when preference storage is unavailable.
  }
}

export function isSidebarSessionFailed(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.done) {
      return message.code !== null && message.code !== undefined && message.code !== 0;
    }
  }
  return false;
}

export function filterSidebarSessions(sessions, filter, runningIds = [], draftSessionIds = [], queuedSessionIds = []) {
  const mode = normalizeSidebarSessionFilter(filter);
  if (mode === 'all') return [...sessions];
  if (mode === 'pinned') return sessions.filter((session) => !!session.pinned);
  if (mode === 'running') {
    const running = new Set(runningIds);
    return sessions.filter((session) => running.has(session.id));
  }
  if (mode === 'draft') {
    const drafts = new Set(draftSessionIds);
    return sessions.filter((session) => drafts.has(session.id));
  }
  if (mode === 'queued') {
    const queued = new Set(queuedSessionIds);
    return sessions.filter((session) => queued.has(session.id));
  }
  return sessions.filter((session) => isSidebarSessionFailed(session));
}

export function countSidebarSessionFilters(sessions, runningIds = [], draftSessionIds = [], queuedSessionIds = []) {
  return {
    all: sessions.length,
    pinned: sessions.filter((session) => !!session.pinned).length,
    running: filterSidebarSessions(sessions, 'running', runningIds).length,
    failed: filterSidebarSessions(sessions, 'failed').length,
    draft: filterSidebarSessions(sessions, 'draft', [], draftSessionIds).length,
    queued: filterSidebarSessions(sessions, 'queued', [], [], queuedSessionIds).length,
  };
}
