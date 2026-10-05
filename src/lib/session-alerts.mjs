// Background-session alerts: "new reply" tracking + per-session stop registry.
// Pure helpers stay here so the rules are unit-testable without React.
export function isUnread(ids, id) {
  return Array.isArray(ids) && ids.includes(id);
}

export function markUnread(ids, id) {
  const list = Array.isArray(ids) ? ids : [];
  if (!id || list.includes(id)) return list;
  return [...list, id];
}

export function clearUnread(ids, id) {
  const list = Array.isArray(ids) ? ids : [];
  if (!id || !list.includes(id)) return list;
  return list.filter((entry) => entry !== id);
}

// Running ChatView panes register their stop callback here so the sidebar
// can stop a background session without switching to it first.
export function createStopRegistry() {
  const handlers = new Map();
  return {
    register(id, stop) {
      if (!id) return;
      if (typeof stop === 'function') handlers.set(id, stop);
      else handlers.delete(id);
    },
    request(id) {
      const stop = handlers.get(id);
      if (typeof stop !== 'function') return false;
      stop();
      return true;
    },
    has(id) {
      return handlers.has(id);
    },
  };
}
