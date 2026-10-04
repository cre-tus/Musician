export function prefillWorkspaceSearchQuery(selectionText) {
  const text = String(selectionText || '').trim();
  if (!text || text.length > 240 || /[\r\n]/.test(text)) return '';
  return text;
}
