// Compressed browser-section annotations ("[주석]").
//
// Right-clicking a browser section stages its full payload (section prompt +
// the question typed in the browser tab) here. The chat composer and history
// only ever show the short token; send-time resolution expands each token,
// left to right, into its staged payload. Anything that cannot be resolved
// (edited token, empty queue) stays literal so nothing is sent silently.
export const ANNOTATION_TOKEN = '[주석]';

const MAX_STAGED = 20;

const staged = [];

export function stageAnnotation(full) {
  const text = String(full || '').trim();
  if (!text) return;
  staged.push(text);
  while (staged.length > MAX_STAGED) staged.shift();
}

export function stagedAnnotationCount() {
  return staged.length;
}

// Expand staged payloads into the token, consuming what was used and
// dropping the rest: sending is the commit point, so a later send never
// replays an old payload.
export function resolveAnnotations(text) {
  const source = String(text || '');
  if (staged.length === 0 || !source.includes(ANNOTATION_TOKEN)) return { text: source, used: 0 };
  let used = 0;
  const out = source.split(ANNOTATION_TOKEN).map((part, index) => {
    if (index === 0) return part;
    const payload = staged[used];
    if (payload === undefined) return `${ANNOTATION_TOKEN}${part}`;
    used += 1;
    return `${payload}${part}`;
  }).join('');
  staged.length = 0;
  return { text: out, used };
}

export function clearAnnotations() {
  staged.length = 0;
}
