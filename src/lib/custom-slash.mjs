// User-defined slash commands: prompt templates triggered by /name.
// Unlike the built-in app-action commands in slash-commands.mjs, a custom
// command expands into composer text (never auto-sends) so the user can
// review and edit before running. $ARGUMENTS (or $ARGS) marks where the
// trailing words after /name are inserted.

export const CUSTOM_SLASH_KEY = 'mudex:custom-slash:v1';
export const CUSTOM_SLASH_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CUSTOM_SLASH_MAX = 50;
export const CUSTOM_SLASH_TEMPLATE_MAX = 4000;
export const CUSTOM_SLASH_DESC_MAX = 120;

export function normalizeCustomSlashName(name) {
  return String(name || '').trim().toLowerCase();
}

export function isCustomSlashNameTaken(name, builtinIds) {
  const ids = Array.isArray(builtinIds) ? builtinIds : [];
  return ids.some((id) => String(id || '').toLowerCase() === String(name || '').toLowerCase());
}

// Parse persisted JSON into a clean list. Never throws; skips invalid rows.
export function parseCustomSlashCommands(raw, builtinIds) {
  let arr;
  try {
    arr = JSON.parse(String(raw == null ? '[]' : raw));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const name = normalizeCustomSlashName(row.name);
    if (!CUSTOM_SLASH_NAME_RE.test(name)) continue;
    if (seen.has(name)) continue;
    if (isCustomSlashNameTaken(name, builtinIds)) continue;
    const template = String(row.template || '');
    if (!template.trim() || template.length > CUSTOM_SLASH_TEMPLATE_MAX) continue;
    const desc = String(row.desc || row.description || '').slice(0, CUSTOM_SLASH_DESC_MAX);
    seen.add(name);
    out.push({ name, template, desc });
    if (out.length >= CUSTOM_SLASH_MAX) break;
  }
  return out;
}

export function serializeCustomSlashCommands(list) {
  const clean = parseCustomSlashCommands(JSON.stringify(Array.isArray(list) ? list : []));
  return JSON.stringify(clean);
}

export function readCustomSlashCommands(storage, builtinIds) {
  try {
    const raw = storage ? storage.getItem(CUSTOM_SLASH_KEY) : null;
    if (raw == null) return [];
    return parseCustomSlashCommands(raw, builtinIds);
  } catch {
    return [];
  }
}

// Returns { ok, error } — error is a short code, never user text.
export function writeCustomSlashCommands(storage, list, builtinIds) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return { ok: false, error: 'NO_STORAGE' };
    const arr = Array.isArray(list) ? list : [];
    if (arr.length > CUSTOM_SLASH_MAX) return { ok: false, error: 'TOO_MANY' };
    const seen = new Set();
    for (const row of arr) {
      const name = normalizeCustomSlashName(row && row.name);
      if (!CUSTOM_SLASH_NAME_RE.test(name)) return { ok: false, error: 'BAD_NAME' };
      if (seen.has(name)) return { ok: false, error: 'DUPLICATE' };
      if (isCustomSlashNameTaken(name, builtinIds)) return { ok: false, error: 'RESERVED' };
      const template = String((row && row.template) || '');
      if (!template.trim()) return { ok: false, error: 'EMPTY_TEMPLATE' };
      if (template.length > CUSTOM_SLASH_TEMPLATE_MAX) return { ok: false, error: 'TEMPLATE_TOO_LONG' };
      seen.add(name);
    }
    const clean = arr.map((row) => ({
      name: normalizeCustomSlashName(row.name),
      template: String(row.template),
      desc: String(row.desc || '').slice(0, CUSTOM_SLASH_DESC_MAX),
    }));
    storage.setItem(CUSTOM_SLASH_KEY, JSON.stringify(clean));
    return { ok: true };
  } catch {
    return { ok: false, error: 'WRITE_FAILED' };
  }
}

// Expand a template with trailing args. Returns { text, cursor }: cursor is
// where the caret should land (args insertion point, else end of text).
export function expandCustomSlash(template, args) {
  const src = String(template || '');
  const argText = String(args == null ? '' : args);
  const trimmedArgs = argText.trim();
  const re = /\$(?:ARGUMENTS|ARGS)\b/g;
  if (re.test(src)) {
    re.lastIndex = 0;
    let firstAt = -1;
    const text = src.replace(re, (match, offset) => {
      if (firstAt < 0) firstAt = offset;
      return argText;
    });
    const cursor = firstAt < 0 ? text.length : firstAt + argText.length;
    return { text, cursor };
  }
  if (!trimmedArgs) return { text: src, cursor: src.length };
  const sep = src && !/\s$/.test(src) ? '\n\n' : '';
  const text = `${src}${sep}${trimmedArgs}`;
  return { text, cursor: text.length };
}

// Match a fully typed "/name ..." line (with trailing args) against known
// custom names. The builtin findSlashCommand only covers the no-space case,
// so this takes over once a space follows a known custom name.
export function findCustomSlash(input, caret, customs) {
  const text = String(input || '');
  const pos = Number.isInteger(caret) ? caret : text.length;
  if (!text.startsWith('/') || pos < 1 || pos > text.length) return null;
  const head = text.slice(0, pos);
  if (head.includes('\n')) return null;
  const m = /^\/([^\s/]+)([ \t]+([\s\S]*))?$/.exec(head);
  if (!m || m[2] == null) return null;
  const name = m[1].toLowerCase();
  const list = Array.isArray(customs) ? customs : [];
  const hit = list.find((c) => c && c.name === name);
  if (!hit) return null;
  return { name: hit.name, args: m[3] || '', template: hit.template, desc: hit.desc || '' };
}

function customScore(cmd, q) {
  if (!q) return 0;
  const name = cmd.name.slice(1).toLowerCase();
  if (name.startsWith(q)) return 290 - name.length;
  if (name.includes(q)) return 190 - name.indexOf(q);
  const hay = `${cmd.title} ${cmd.hint}`.toLowerCase();
  if (hay.includes(q)) return 90 - hay.indexOf(q) * 0.1;
  return -1;
}

// Shape matches SlashCommand plus kind/template so the composer popup can
// render built-ins and customs in one list.
export function matchCustomSlashCommands(query, customs, limit = 16) {
  const q = String(query || '').trim().toLowerCase();
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 16;
  const list = Array.isArray(customs) ? customs : [];
  return list
    .map((c, order) => {
      const cmd = {
        id: `custom:${c.name}`,
        name: `/${c.name}`,
        title: c.desc || `/${c.name}`,
        hint: c.desc ? `/${c.name}` : '',
        keywords: [],
        kind: 'custom',
        template: c.template,
      };
      return { cmd, order, score: customScore(cmd, q) };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, cap)
    .map((item) => item.cmd);
}
