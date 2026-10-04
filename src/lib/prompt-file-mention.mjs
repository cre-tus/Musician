export function findPromptFileMention(value, cursor) {
  const text = String(value || '');
  const caret = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : text.length, text.length));
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || (start > 0 && /[\p{L}\p{N}_]/u.test(before[start - 1]))) return null;
  const typed = before.slice(start + 1);
  const quote = typed[0] === '"' || typed[0] === "'" ? typed[0] : '';
  if (quote && typed.slice(1).includes(quote)) return null;
  const query = quote ? typed.slice(1) : typed;
  if (!quote && /\s/.test(query)) return null;
  return { start, end: caret, query };
}

export function insertPromptFileMention(value, mention, relativePath) {
  const text = String(value || '');
  const start = Math.max(0, Math.min(mention?.start ?? text.length, text.length));
  const end = Math.max(start, Math.min(mention?.end ?? start, text.length));
  const before = text.slice(0, start);
  const after = text.slice(end);
  const path = String(relativePath || '').replace(/`/g, '\\`');
  const token = `\`${path}\``;
  const prefixSpace = before && !/\s$/.test(before) ? ' ' : '';
  const suffixSpace = after && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefixSpace}${token}${suffixSpace}`;
  const next = `${before}${insertion}${after}`;
  return { value: next, cursor: before.length + insertion.length };
}
