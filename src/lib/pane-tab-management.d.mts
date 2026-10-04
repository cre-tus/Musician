export function unpinnedPaneTabIds<T extends { id: string; pinned?: boolean }>(tabs: T[]): string[];
export function ensureFilesTabFallback<T>(tabs: T[], createFilesTab: () => T): T[];
