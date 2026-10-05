// Session backup: lossless JSON export + import round-trip.
// Markdown transcripts stay human-readable; this format is for backup/restore.
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;
export const BACKUP_MAX_SESSIONS = 200;
export const BACKUP_MAX_MESSAGES = 2000;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function cleanTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? n : undefined;
}

export function createSessionBackup(sessions, options = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const exportedAt = cleanTimestamp(options.exportedAt) ?? Date.now();
  return JSON.stringify({
    app: 'musician',
    kind: 'session-backup',
    version: BACKUP_VERSION,
    exportedAt,
    sessions: list.map((s) => ({
      title: cleanText(s?.title),
      cwd: typeof s?.cwd === 'string' ? s.cwd : undefined,
      createdAt: cleanTimestamp(s?.createdAt),
      engine: s?.engine === 'msp' || s?.engine === 'exec' ? s.engine : undefined,
      pinned: s?.pinned === true ? true : undefined,
      messages: Array.isArray(s?.messages) ? s.messages.filter(isPlainObject) : [],
    })),
  });
}

export function parseSessionBackup(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'EMPTY_FILE' };
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: 'TOO_LARGE' };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (!isPlainObject(doc) || doc.app !== 'musician' || doc.kind !== 'session-backup') {
    return { ok: false, error: 'NOT_BACKUP' };
  }
  if (doc.version !== BACKUP_VERSION) return { ok: false, error: 'UNSUPPORTED_VERSION' };
  if (!Array.isArray(doc.sessions) || doc.sessions.length === 0) return { ok: false, error: 'NO_SESSIONS' };
  if (doc.sessions.length > BACKUP_MAX_SESSIONS) return { ok: false, error: 'TOO_MANY_SESSIONS' };
  const sessions = [];
  for (const raw of doc.sessions) {
    if (!isPlainObject(raw)) return { ok: false, error: 'BAD_SESSION' };
    const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    if (rawMessages.length > BACKUP_MAX_MESSAGES) return { ok: false, error: 'TOO_MANY_MESSAGES' };
    const messages = [];
    for (const rawMsg of rawMessages) {
      if (!isPlainObject(rawMsg)) return { ok: false, error: 'BAD_MESSAGE' };
      if (rawMsg.role !== 'user' && rawMsg.role !== 'assistant') return { ok: false, error: 'BAD_MESSAGE' };
      if (typeof rawMsg.text !== 'string') return { ok: false, error: 'BAD_MESSAGE' };
      messages.push({ ...rawMsg });
    }
    sessions.push({
      title: cleanText(raw.title),
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      createdAt: cleanTimestamp(raw.createdAt),
      engine: raw.engine === 'msp' || raw.engine === 'exec' ? raw.engine : undefined,
      pinned: raw.pinned === true,
      messages,
    });
  }
  return { ok: true, sessions };
}

// Assign fresh ids so imports never collide with live sessions. Host links
// (mspSessionId) are dropped: they point at another machine's agent host.
export function toImportSessions(parsedSessions, options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const now = cleanTimestamp(options.now) ?? Date.now();
  const list = Array.isArray(parsedSessions) ? parsedSessions : [];
  return list.map((s) => ({
    id: createId(),
    title: cleanText(s?.title),
    cwd: typeof s?.cwd === 'string' && s.cwd ? s.cwd : undefined,
    createdAt: cleanTimestamp(s?.createdAt) ?? now,
    engine: s?.engine === 'msp' || s?.engine === 'exec' ? s.engine : undefined,
    pinned: s?.pinned === true,
    archived: false,
    messages: (Array.isArray(s?.messages) ? s.messages : []).filter(isPlainObject).map((m) => {
      // Drop host links and checkpoint pointers: both reference the machine
      // the backup came from, and a stale checkpoint restore could destroy
      // unrelated work. Message ids stay: patch/update is session-scoped.
      const { mspSessionId: _host, checkpointId: _cp, ...rest } = m;
      return {
        ...rest,
        id: typeof m.id === 'string' && m.id ? m.id : createId(),
        ts: cleanTimestamp(m.ts) ?? now,
        done: m.done !== false,
      };
    }),
  }));
}
