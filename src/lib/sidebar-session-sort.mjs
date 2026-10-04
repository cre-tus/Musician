const STORAGE_KEY = 'mudex:sidebar-session-sort:v1';
const SORT_MODES = new Set(['recent', 'oldest', 'name']);

export function normalizeSidebarSessionSort(value) {
  return SORT_MODES.has(value) ? value : 'recent';
}

export function readSidebarSessionSort(storage) {
  try {
    const target = storage || globalThis.localStorage;
    return normalizeSidebarSessionSort(target?.getItem(STORAGE_KEY));
  } catch {
    return 'recent';
  }
}

export function writeSidebarSessionSort(value, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, normalizeSidebarSessionSort(value));
  } catch {
    // Sorting remains usable when preference storage is unavailable.
  }
}

function lastActivity(session) {
  const lastMessage = session?.messages?.[session.messages.length - 1];
  return Number(lastMessage?.ts) || Number(session?.createdAt) || 0;
}

export function compareSidebarSessions(a, b, sort = 'recent') {
  const mode = normalizeSidebarSessionSort(sort);
  let result = 0;
  if (mode === 'name') {
    result = String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { numeric: true, sensitivity: 'base' });
  } else {
    result = mode === 'oldest' ? lastActivity(a) - lastActivity(b) : lastActivity(b) - lastActivity(a);
  }
  return result || String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { numeric: true, sensitivity: 'base' })
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}
