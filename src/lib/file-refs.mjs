// file:line references inside logs, errors, and review text: split plain
// text into literal chunks and clickable { file, line, col } refs.
// Conservative by design: bare :port numbers, URLs, and IPv4 hosts never
// become refs. Exit 0 = ALL PASS (see file-refs-test assertions inside
// rerun-compare-test).
const REF_RE = /((?:[A-Za-z]:)?[^\s:;,()"'`\]{}]*\.[A-Za-z0-9]{1,10}):(\d{1,6})(?::(\d{1,6}))?/g;

function looksLikeIpv4(host) {
  const parts = String(host).split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p));
}

export function splitFileRefs(text) {
  const src = String(text || '');
  if (!src) return [];
  const out = [];
  REF_RE.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = REF_RE.exec(src)) !== null) {
    const [whole, file, lineRaw, colRaw] = m;
    const before = src[m.index - 1] || '';
    const line = Number(lineRaw);
    const bad =
      before === '/' || // URL host:port (https://example.com:443)
      file.includes('//') || // scheme remnant (s://example.com:443)
      looksLikeIpv4(file) || // 127.0.0.1:8000 is a port, not a line
      !/[A-Za-z]/.test(file) || // pure numbers/dots
      !Number.isInteger(line) ||
      line < 1 ||
      line > 999999;
    if (bad) continue;
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({
      file,
      line,
      col: colRaw ? Number(colRaw) : null,
      text: whole,
    });
    last = m.index + whole.length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out.filter((s) => typeof s.text === 'string' && s.text !== '');
}

// Join a repo-relative ref onto a working folder (POSIX refs, either OS).
export function joinAbs(cwd, rel) {
  const base = String(cwd || '');
  const r = String(rel || '').replace(/\//g, base.includes('\\') ? '\\' : '/');
  if (!base) return r;
  if (/^[A-Za-z]:[\\/]/.test(r) || r.startsWith('/') || r.startsWith('\\\\')) return r;
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.endsWith(sep) ? base : base + sep}${r}`;
}
