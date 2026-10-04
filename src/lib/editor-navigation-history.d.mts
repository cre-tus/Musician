export interface EditorLocation {
  path: string;
  line: number;
  column: number;
}

export interface EditorNavigationHistory {
  entries: EditorLocation[];
  index: number;
  bookmarks: EditorLocation[];
}

export function editorNavigationStorageKey(folder: string): string;
export function readEditorNavigationHistory(folder: string, storage?: Storage): EditorNavigationHistory;
export function writeEditorNavigationHistory(folder: string, history: EditorNavigationHistory, storage?: Storage): boolean;
export function toggleEditorLocationBookmark(bookmarks: EditorLocation[], location: EditorLocation, limit?: number): { bookmarks: EditorLocation[]; bookmarked: boolean };
export function pushEditorLocation(entries: EditorLocation[], index: number, location: EditorLocation, limit?: number): { entries: EditorLocation[]; index: number };
export function stepEditorLocation(entries: EditorLocation[], index: number, direction: 1 | -1): { index: number; location: EditorLocation | null };
export function remapEditorNavigationPaths(history: EditorNavigationHistory, oldPath: string, newPath: string): EditorNavigationHistory;
export function removeEditorNavigationPaths(history: EditorNavigationHistory, removedPath: string): EditorNavigationHistory;
