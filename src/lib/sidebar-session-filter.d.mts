export type SidebarSessionFilter = 'all' | 'pinned' | 'running' | 'failed' | 'draft' | 'queued';
export function normalizeSidebarSessionFilter(value: unknown): SidebarSessionFilter;
export function readSidebarSessionFilter(storage?: Pick<Storage, 'getItem'>): SidebarSessionFilter;
export function writeSidebarSessionFilter(value: unknown, storage?: Pick<Storage, 'setItem'>): void;
export function isSidebarSessionFailed(session: unknown): boolean;
export function filterSidebarSessions<T extends { id: string }>(sessions: T[], filter: SidebarSessionFilter, runningIds?: string[], draftSessionIds?: string[], queuedSessionIds?: string[]): T[];
export function countSidebarSessionFilters(sessions: Array<{ id: string; pinned?: boolean }>, runningIds?: string[], draftSessionIds?: string[], queuedSessionIds?: string[]): Record<SidebarSessionFilter, number>;
