// Live context-window pressure from the serve host (`session/contextUsage`
// → `msp:context`). The host owns the window size; the app never invents
// one. Unknown or malformed payloads yield null so the UI falls back to the
// observed cumulative totals instead of showing a fake percent.
export function summarizeContextPressure(p) {
  if (!p || typeof p !== 'object') return null;
  const used = Number(p.usedTokens);
  const win = Number(p.windowTokens);
  if (!Number.isFinite(used) || used < 0) return null;
  if (!Number.isFinite(win) || win <= 0) return null;
  const pct = Math.min(100, Math.max(0, (used / win) * 100));
  return {
    used: Math.floor(used),
    window: Math.floor(win),
    pct,
    remaining: Math.max(0, Math.floor(win) - Math.floor(used)),
    pressure: typeof p.pressure === 'string' && p.pressure ? p.pressure : null,
    sessionId: typeof p.sessionId === 'string' ? p.sessionId : null,
  };
}

export function formatPressurePct(pct) {
  const v = Number(pct);
  if (!Number.isFinite(v)) return '';
  return `${v >= 99.95 ? Math.round(v) : (Math.round(v * 10) / 10)}%`;
}
