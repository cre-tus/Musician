// Fresh ids mirror mudex.ts uid() (prefix-base36_time-rand6) without
// importing it: this module must run dependency-free under plain node.
function makeId(prefix, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  return `${prefix}-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function duplicateSession(session, options) {
  if (!session || typeof session !== 'object') return null;
  if (typeof session.id !== 'string' || !session.id) return null;
  if (!Array.isArray(session.messages)) return null;
  const opts = options && typeof options === 'object' ? options : {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  let messages;
  try {
    messages = JSON.parse(JSON.stringify(session.messages));
  } catch {
    return null;
  }
  const title = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : '새 스레드';
  return {
    id: makeId('s', now),
    title: `${title} 복사본`,
    createdAt: now,
    messages: messages
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({ ...m, id: makeId('m', now) })),
    ...(typeof session.cwd === 'string' && session.cwd ? { cwd: session.cwd } : {}),
    ...(session.engine === 'msp' || session.engine === 'exec' ? { engine: session.engine } : {}),
    // mspSessionId deliberately dropped: the copy must not resume the
    // source's server-side session. pinned/archived reset: a copy is a
    // fresh working session.
  };
}
