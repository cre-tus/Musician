// Split a shortcut label like "Ctrl+Shift+P / Ctrl+K" into renderable parts:
// { type: 'keys', text } for each chord shown in its own <kbd>, and
// { type: 'sep', text } for the '/' or '·' separators between them.
export function splitShortcutKeys(value) {
  let text = String(value || '').trim();
  if (!text) return [];
  // A leading/trailing separator with a chord on the other side is junk
  // ('Ctrl+S /'); a lone '/' or '·' is itself the chord.
  if (text.length > 1) {
    text = text.replace(/^(?:\/|·)\s+/, '').replace(/\s+(?:\/|·)$/, '');
    if (!text) return [];
  }
  const raw = [];
  // Only whitespace-surrounded separators split: a leading slash (slash
  // commands) or a tight '←/→' stays part of its chord. A bare '/' or '·'
  // counts as a separator only when the split kept its whitespace.
  for (const token of text.split(/(\s+\/\s+|\s+·\s+)/g)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if ((trimmed === '/' || trimmed === '·') && token !== trimmed) raw.push({ type: 'sep', text: trimmed });
    else raw.push({ type: 'keys', text: trimmed });
  }
  // Drop separators without a chord on both sides ("/", "Ctrl+S /").
  const parts = [];
  for (const part of raw) {
    if (part.type === 'sep' && (parts.length === 0 || parts[parts.length - 1].type === 'sep')) continue;
    parts.push(part);
  }
  while (parts.length > 0 && parts[parts.length - 1].type === 'sep') parts.pop();
  return parts;
}

// Index-based group id: titles contain spaces, which are invalid in ids and
// break the dialog's aria-labelledby references.
export function shortcutGroupId(index) {
  return `shortcuts-group-${index}`;
}
