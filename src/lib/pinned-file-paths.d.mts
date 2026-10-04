export function normalizePinnedFilePath(path: string): string;
export function pinnedFileStorageKey(folder: string): string;
export function readPinnedFilePaths(folder: string, storage?: Pick<Storage, 'getItem'>): string[];
export function renamePinnedFilePaths(paths: string[], oldPath: string, newPath: string, isDirectory?: boolean): string[];
export function removePinnedFilePaths(paths: string[], removedPath: string, isDirectory?: boolean): string[];
export function pinnedFileParentDirectories(paths: string[], root: string): string[];
export function reconcilePinnedFilePaths(paths: string[], root: string, listDirectory: (directory: string) => Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDir: boolean }> }>): Promise<string[]>;
