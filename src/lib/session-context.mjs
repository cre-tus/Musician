// Per-session context meter: aggregate token usage and turn counts from the
// messages already in memory. No model-limit math here — limits differ per
// model and plan, so the UI shows observed totals, never a fake percent.
export function summarizeSessionContext(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let input = 0;
  let output = 0;
  let cached = 0;
  let reasoning = 0;
  let turns = 0;
  let observed = 0;
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') turns += 1;
    const u = m.usage;
    if (!u || typeof u !== 'object') continue;
    const i = Number(u.inputTokens) || 0;
    const o = Number(u.outputTokens) || 0;
    if (i > 0 || o > 0) observed += 1;
    input += i;
    output += o;
    cached += Number(u.cachedTokens) || 0;
    reasoning += Number(u.reasoningTokens) || 0;
  }
  return {
    input,
    output,
    cached,
    reasoning,
    total: input + output,
    turns,
    messages: list.length,
    observed,
  };
}

export function formatCompactTokens(n) {
  const v = Math.floor(Number(n) || 0);
  if (v < 1000) return String(v);
  if (v < 1000000) {
    const k = v / 1000;
    return `${k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10)}k`;
  }
  const m = v / 1000000;
  return `${m >= 100 ? Math.round(m) : (Math.round(m * 10) / 10)}M`;
}
