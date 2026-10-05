// Per-session model / reasoning-effort overrides. Empty string means
// "follow the global setting". Pure + unit-tested; the tune dialog, the
// composer pill, and the send path all resolve through here.
export const EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function sanitizeEffort(value) {
  return EFFORT_VALUES.includes(value) ? value : '';
}

export function sanitizeModel(value) {
  const id = String(value || '').trim();
  return id.length > 0 && id.length <= 200 ? id : '';
}

export function resolveModel(session, settings) {
  const override = sanitizeModel(session?.modelOverride);
  if (override) return { value: override, overridden: true };
  return { value: sanitizeModel(settings?.model), overridden: false };
}

export function resolveEffort(session, settings) {
  const override = sanitizeEffort(session?.effortOverride);
  if (override) return { value: override, overridden: true };
  return { value: sanitizeEffort(settings?.reasoningEffort), overridden: false };
}

export function hasOverride(session) {
  return !!(sanitizeModel(session?.modelOverride) || sanitizeEffort(session?.effortOverride));
}

// What the send path forwards to the engines. Only non-empty overrides;
// empty means "global already applies, nothing to do".
export function sendOverrides(session) {
  const out = {};
  const model = sanitizeModel(session?.modelOverride);
  const effort = sanitizeEffort(session?.effortOverride);
  if (model) out.model = model;
  if (effort) out.effort = effort;
  return out;
}
