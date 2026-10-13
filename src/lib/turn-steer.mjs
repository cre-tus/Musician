// Live steering: deliver a follow-up instruction into the RUNNING turn
// without cancelling it. Enforcement lives in the engine (`turn/start`
// with `ifBusy: "steer"` folds the input into the live turn); this module
// only gates the UI affordance and shapes the display text. Anything the
// engine cannot steer (exec one-shots, idle sessions) reports honestly
// instead of pretending.
export const STEER_DISPLAY_MAX = 200;

export function canSteerRun({ engine, run, hasBridge } = {}) {
  if (!hasBridge) return false;
  if (!run || typeof run !== 'object' || !run.reqId) return false;
  return engine === 'msp';
}

export function steerDisplayText(text, max = STEER_DISPLAY_MAX) {
  const s = String(text || '').trim();
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : STEER_DISPLAY_MAX;
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…`;
}
