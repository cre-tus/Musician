// Turn hooks: user shell commands fired on turn events (Claude Code style).
// v1 events: turn-start (awaited, bounded) and turn-done (fire-and-forget).
// Hooks never block a turn on failure — results surface as notices.
export const HOOK_EVENTS = ['turn-start', 'turn-done'];
export const HOOK_MAX = 20;
export const HOOK_COMMAND_MAX = 1000;
export const HOOK_TIMEOUT_DEFAULT = 30;
export const HOOK_TIMEOUT_MIN = 5;
export const HOOK_TIMEOUT_MAX = 120;

export function normalizeHookTimeout(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return HOOK_TIMEOUT_DEFAULT;
  return Math.min(HOOK_TIMEOUT_MAX, Math.max(HOOK_TIMEOUT_MIN, n));
}

// Parse persisted hooks into a clean list. Never throws; skips invalid rows.
export function parseHooks(raw) {
  let arr;
  try {
    arr = JSON.parse(String(raw == null ? '[]' : raw));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const event = String(row.event || '');
    if (!HOOK_EVENTS.includes(event)) continue;
    const command = String(row.command || '').trim();
    if (!command || command.length > HOOK_COMMAND_MAX) continue;
    const key = `${event}\0${command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      event,
      command,
      enabled: row.enabled !== false,
      timeoutSec: normalizeHookTimeout(row.timeoutSec),
    });
    if (out.length >= HOOK_MAX) break;
  }
  return out;
}

// Validate a draft list from the settings UI. Returns { ok, error } with a
// short code; error rows are 1-based in `index` when known.
export function validateHooks(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > HOOK_MAX) return { ok: false, error: 'TOO_MANY' };
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    const event = String((row && row.event) || '');
    if (!HOOK_EVENTS.includes(event)) return { ok: false, error: 'BAD_EVENT', index: i + 1 };
    const command = String((row && row.command) || '').trim();
    if (!command) return { ok: false, error: 'EMPTY_COMMAND', index: i + 1 };
    if (command.length > HOOK_COMMAND_MAX) return { ok: false, error: 'COMMAND_TOO_LONG', index: i + 1 };
    const key = `${event}\0${command}`;
    if (seen.has(key)) return { ok: false, error: 'DUPLICATE', index: i + 1 };
    seen.add(key);
  }
  return { ok: true };
}

export function matchHooks(hooks, event) {
  const list = Array.isArray(hooks) ? hooks : [];
  return list.filter((h) => h && h.event === event && h.enabled !== false && String(h.command || '').trim());
}

export function cleanHooks(list) {
  return parseHooks(JSON.stringify(Array.isArray(list) ? list : []));
}
