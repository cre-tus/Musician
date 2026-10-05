// Last-known subscription usage. A serve host only learns usage from its own
// live turns, so after an app relaunch the host knows nothing until the next
// turn. Cache the last observation (24h TTL, void once the weekly window
// resets) and show it labeled instead of "waiting".
const KEY = 'mudex:last-usage:v1';
const TTL_MS = 24 * 3600 * 1000;

function isUsage(u) {
  return !!u && typeof u === 'object'
    && typeof u.tier === 'string'
    && typeof u.observedAtMs === 'number'
    && !!u.window && typeof u.window.usedPercent === 'number' && typeof u.window.resetsAtMs === 'number'
    && !!u.weekly && typeof u.weekly.usedPercent === 'number' && typeof u.weekly.resetsAtMs === 'number';
}

export function saveLastUsage(storage, usage, now = Date.now()) {
  if (!isUsage(usage)) return;
  try {
    storage.setItem(KEY, JSON.stringify({ usage, cachedAtMs: now }));
  } catch { /* private mode etc: cache is best effort */ }
}

export function loadLastUsage(storage, now = Date.now()) {
  let raw = null;
  try { raw = storage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.cachedAtMs !== 'number') return null;
    if (now - parsed.cachedAtMs > TTL_MS) return null;
    if (!isUsage(parsed.usage)) return null;
    if (now > parsed.usage.weekly.resetsAtMs) return null;
    return parsed.usage;
  } catch { return null; }
}
