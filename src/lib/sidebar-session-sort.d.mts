export type SidebarSessionSort = 'recent' | 'oldest' | 'name';
export function normalizeSidebarSessionSort(value: unknown): SidebarSessionSort;
export function readSidebarSessionSort(storage?: Pick<Storage, 'getItem'>): SidebarSessionSort;
export function writeSidebarSessionSort(value: unknown, storage?: Pick<Storage, 'setItem'>): void;
export function compareSidebarSessions(a: unknown, b: unknown, sort?: SidebarSessionSort): number;
