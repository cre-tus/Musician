// Pending-approval sidebar badges: engine threadKeys (a base session id with
// an optional \0plan / \0review lane suffix) folded into per-session counts
// so rows the user is not looking at can carry a jump badge.
export function baseApprovalSession(threadKey) {
  const raw = String(threadKey || '');
  const cut = raw.indexOf('\0');
  return cut < 0 ? raw : raw.slice(0, cut);
}

export function summarizeApprovalCounts(counts) {
  const out = {};
  if (!counts || typeof counts !== 'object') return out;
  for (const [key, value] of Object.entries(counts)) {
    const sid = baseApprovalSession(key);
    const n = Math.floor(Number(value) || 0);
    if (!sid || n <= 0) continue;
    out[sid] = (out[sid] || 0) + n;
  }
  return out;
}
