export type PaletteScope = 'all' | 'commands' | 'sessions' | 'tabs';
export function matchScore(query: string, candidates: string[]): number;
export function parsePaletteQuery(value: string): { scope: PaletteScope; query: string };
export function scopePaletteItems<T extends { id: string }>(scope: PaletteScope, threads: T[], actions: T[]): { threads: T[]; actions: T[] };
