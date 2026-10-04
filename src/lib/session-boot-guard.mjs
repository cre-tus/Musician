// Boot file backup must never clobber sessions the user already changed
// (add/delete/message) while the async load was still in flight. The caller
// passes the array reference captured before the load started (`boot`) and
// the latest state at resolve time (`current`): any setSessions in between
// produces a new array, so reference inequality means the user diverged and
// their state wins. The file copy remains the crash-recovery source of truth
// only when nothing changed meanwhile.
export function resolveBootSessions(current, boot, loaded) {
  const isValid = (session) => !!session && typeof session.id === 'string' && Array.isArray(session.messages);
  const list = Array.isArray(loaded) ? loaded : [];
  const clean = list.every(isValid) ? list : list.filter(isValid);
  if (clean.length === 0) return current;
  if (current !== boot) return current;
  return clean;
}
