'use strict';

const path = require('node:path');

function createProjectSessionCache(loadSessions, { ttlMs = 60000, maxEntries = 8, now = Date.now } = {}) {
  const entries = new Map();

  function keyFor(cwd) {
    const resolved = path.resolve(String(cwd || ''));
    const root = path.parse(resolved).root;
    const normalized = resolved === root ? root : resolved.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  function get(cwd, { refresh = false } = {}) {
    if (!cwd) return [];
    const key = keyFor(cwd);
    const cached = entries.get(key);
    const currentTime = now();
    if (!refresh && cached && currentTime - cached.cachedAt < ttlMs) return cached.sessions;

    const sessions = loadSessions(cwd);
    entries.delete(key);
    entries.set(key, { cachedAt: currentTime, sessions });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return sessions;
  }

  return { get, clear: () => entries.clear() };
}

module.exports = { createProjectSessionCache };
