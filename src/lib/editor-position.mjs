export function parseEditorPosition(value) {
  const match = /^(\d+)(?::(\d+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const line = Number(match[1]);
  const column = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) return null;
  return { line, column };
}
