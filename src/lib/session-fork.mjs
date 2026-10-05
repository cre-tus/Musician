// Fork a session from one of its messages: the new session carries the
// history prefix up to and including that message. Same-machine branch
// (unlike backup import), so file references stay, but the host link is
// dropped — the fork must start its own agent session on the next turn.
export function forkSession(session, messageId, options = {}) {
  if (!session || typeof session !== 'object' || !messageId) return null;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const idx = messages.findIndex((m) => m && m.id === messageId);
  if (idx < 0) return null;
  const createId = typeof options.createId === 'function' ? options.createId : (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const prefix = messages.slice(0, idx + 1).map((m) => ({ ...m }));
  return {
    id: createId(),
    title: typeof options.title === 'string' && options.title ? options.title : String(session.title || ''),
    createdAt: now,
    messages: prefix,
    ...(typeof session.cwd === 'string' && session.cwd ? { cwd: session.cwd } : {}),
    ...(session.engine === 'msp' || session.engine === 'exec' ? { engine: session.engine } : {}),
    ...(typeof session.modelOverride === 'string' && session.modelOverride ? { modelOverride: session.modelOverride } : {}),
    ...(typeof session.effortOverride === 'string' && session.effortOverride ? { effortOverride: session.effortOverride } : {}),
    pinned: false,
    archived: false,
  };
}
