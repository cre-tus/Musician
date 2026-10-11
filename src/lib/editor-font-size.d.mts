export const DEFAULT_EDITOR_FONT_SIZE: number;
export const MIN_EDITOR_FONT_SIZE: number;
export const MAX_EDITOR_FONT_SIZE: number;
export function resolveEditorFontSize(stored: unknown): number;
export function adjustEditorFontSize(current: number, delta: number): number;
export const EDITOR_FONT_FIELD_SELECTOR: string;
export function editorFontZoomDelta(key: string, code: string): 1 | -1 | 0 | null;
export function shouldHandleEditorFontZoom(options: {
  inMonaco: boolean;
  activeFileTab: boolean;
  inRightPane: boolean;
  inField: boolean;
}): boolean;
