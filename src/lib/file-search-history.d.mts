export type FileSearchMode = 'name' | 'content';
export interface FileSearchHistoryEntry { query: string; mode: FileSearchMode }
export function fileSearchHistoryKey(folder: string): string;
export function normalizeFileSearchHistory(value: unknown): FileSearchHistoryEntry[];
export function recordFileSearchQuery(history: unknown, query: string, mode: FileSearchMode): FileSearchHistoryEntry[];
export function readFileSearchHistory(folder: string, storage?: Storage): FileSearchHistoryEntry[];
export function writeFileSearchHistory(folder: string, history: unknown, storage?: Storage): boolean;
