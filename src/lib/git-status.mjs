// Pure parser shared by the renderer and the small Node-based regression test.
export function porcelainPath(entry) {
  let value = String(entry || '').trim();
  if (!value) return '';
  value = value.length > 2 ? value.slice(2).trim() : '';
  const arrow = value.indexOf(' -> ');
  if (arrow >= 0) value = value.slice(arrow + 4).trim();
  if (value.length >= 2 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
    value = value.slice(1, -1);
  }
  return value;
}

export function porcelainStatus(entry) {
  const status = String(entry || '').trim().slice(0, 2);
  if (status === '??') return 'U';
  if (status.includes('U') || status === 'AA' || status === 'DD') return 'C';
  if (status.includes('T')) return 'T';
  if (status.includes('R')) return 'R';
  if (status.includes('D')) return 'D';
  if (status.includes('A')) return 'A';
  return 'M';
}

// X column of a RAW porcelain v1 line (leading space is significant — callers
// must not trim before asking). True when the index holds changes for the path.
export function porcelainStaged(entry) {
  const raw = String(entry || '');
  if (raw.length < 2) return false;
  const x = raw[0];
  return x !== ' ' && x !== '?' && x !== '!';
}

export function normalizeCommitMessage(message) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'EMPTY_MESSAGE' };
  if (text.length > 2000) return { ok: false, error: 'MESSAGE_TOO_LONG' };
  return { ok: true, message: text };
}

// `git rev-list --left-right --count HEAD...@{upstream}` prints "ahead\tbehind".
export function parseUpstreamCounts(output) {
  const parts = String(output || '').trim().split(/\s+/);
  const ahead = Number.parseInt(parts[0], 10);
  const behind = Number.parseInt(parts[1], 10);
  return {
    ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : 0,
    behind: Number.isFinite(behind) && behind >= 0 ? behind : 0,
  };
}
