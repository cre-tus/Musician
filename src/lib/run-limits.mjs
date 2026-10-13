// Run limits: opt-in ceilings next to the existing timeout. Zero disables,
// matching `timeoutMs: 0`. Token ceilings count a turn's observed input +
// output tokens (the same totals the context meter shows); the auto-run
// ceiling counts consecutive automatic chained turns (queue drain, timeout
// resume, interrupt resume) so a looping agent cannot spin forever.
export function normalizeRunLimits(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const tokens = Math.floor(Number(s.maxTurnTokens) || 0);
  const auto = Math.floor(Number(s.maxAutoRuns) || 0);
  return {
    maxTurnTokens: tokens > 0 ? tokens : 0,
    maxAutoRuns: auto > 0 ? auto : 0,
  };
}

export function turnTokenTotal(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return (Math.floor(Number(usage.inputTokens) || 0) + Math.floor(Number(usage.outputTokens) || 0));
}

export function tokenLimitHit(usage, limits) {
  const lim = normalizeRunLimits(limits);
  if (lim.maxTurnTokens <= 0) return false;
  return turnTokenTotal(usage) > lim.maxTurnTokens;
}

export function autoRunAllowed(autoCount, limits) {
  const lim = normalizeRunLimits(limits);
  if (lim.maxAutoRuns <= 0) return true;
  return Math.floor(Number(autoCount) || 0) < lim.maxAutoRuns;
}
