export function normalizeRecentCommandIds(value: unknown, limit?: number): string[];
export function recordRecentCommand(ids: unknown, id: string, limit?: number): string[];
export function readRecentCommandIds(storage?: Pick<Storage, 'getItem'>): string[];
export function writeRecentCommandIds(ids: unknown, storage?: Pick<Storage, 'setItem'>): void;
