import type { PaneTab } from '../types';

export interface EditorDraft {
  path: string;
  original: string;
  content: string;
  originalHash: string;
}

export function normalizeDraftPath(value: string): string;
export function editorDraftStorageKey(scope?: string): string;
export function hashEditorText(value: string): string;
export function readEditorDrafts(storage?: Pick<Storage, 'getItem'>, scope?: string): EditorDraft[];
export function writeEditorDrafts(
  tabs: PaneTab[],
  activeTabId: string,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
  scope?: string,
): { savedCount: number; omittedCount: number };
export function findEditorDraft(drafts: EditorDraft[], filePath: string): EditorDraft | null;
export function restoreEditorDraft(
  diskContent: string,
  draft: EditorDraft | null,
): { original: string; content: string; dirty: boolean; diskChanged: boolean };
