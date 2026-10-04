import { normalizePathForComparison } from './path-utils.mjs';

// Detach a removed project's visible sessions so its sidebar group disappears.
// Sessions are preserved (moved to the no-folder group); archived sessions
// keep their recorded cwd as history.
export function detachProjectSessions(sessions, folder) {
  const key = normalizePathForComparison(folder);
  if (!key || !Array.isArray(sessions)) return sessions;
  let changed = false;
  const next = sessions.map((session) => {
    if (!session || session.archived) return session;
    if (normalizePathForComparison(session.cwd) !== key) return session;
    if (!session.cwd) return session;
    changed = true;
    return { ...session, cwd: '' };
  });
  return changed ? next : sessions;
}
