export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 24;
const LEGACY_DEFAULT_EDITOR_FONT_SIZE = 13;

export function resolveEditorFontSize(stored) {
  const value = Math.round(Number(stored));
  if (!Number.isFinite(value)) return DEFAULT_EDITOR_FONT_SIZE;
  if (value === LEGACY_DEFAULT_EDITOR_FONT_SIZE) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, value));
}

export function adjustEditorFontSize(current, delta) {
  const value = Number.isFinite(current) ? Math.round(current) : DEFAULT_EDITOR_FONT_SIZE;
  const amount = Number.isFinite(delta) ? Math.round(delta) : 0;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, value + amount));
}

export const EDITOR_FONT_FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], .xterm-helper-textarea';

export function editorFontZoomDelta(key, code) {
  const normalized = String(key ?? '').toLowerCase();
  if (normalized === '+' || normalized === '=' || code === 'NumpadAdd') return 1;
  if (normalized === '-' || normalized === '_' || code === 'NumpadSubtract') return -1;
  if (normalized === '0' || code === 'Numpad0') return 0;
  return null;
}

export function shouldHandleEditorFontZoom({ inMonaco, activeFileTab, inRightPane, inField }) {
  if (inMonaco) return true;
  return !!activeFileTab && !!inRightPane && !inField;
}
