// Follow-stuck output count: while the user holds their scroll position,
// new messages pile up below; the follow button shows how many.
export function stuckOutputCount(baseLen, curLen) {
  const base = Math.max(0, Math.floor(Number(baseLen) || 0));
  const cur = Math.max(0, Math.floor(Number(curLen) || 0));
  return Math.max(0, cur - base);
}
