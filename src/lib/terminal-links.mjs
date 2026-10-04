// Bare http(s) URL spans in one terminal line, with 1-based columns for
// xterm ranges. Trailing punctuation is trimmed; a trailing ')' survives
// only when it balances an opener inside the URL.
const URL_PATTERN = /https?:\/\/[^\s<>"'\]]+/g;
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', '"', "'", ']']);

function trimUrl(raw) {
  let end = raw.length;
  while (end > 0 && TRAILING_PUNCT.has(raw[end - 1])) end -= 1;
  let candidate = raw.slice(0, end);
  while (candidate.endsWith(')')) {
    const open = (candidate.match(/\(/g) || []).length;
    const close = (candidate.match(/\)/g) || []).length;
    if (close <= open) break;
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

export function findTerminalLinks(line, limit = 8) {
  if (typeof line !== 'string' || !line) return [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 8;
  const out = [];
  URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_PATTERN.exec(line)) !== null && out.length < cap) {
    const url = trimUrl(match[0]);
    if (url.length <= 'https://'.length) continue;
    const start = match.index + 1;
    out.push({ start, end: start + url.length, url });
  }
  return out;
}
