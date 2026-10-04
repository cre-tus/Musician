export function normalizePinnedProjects(value: unknown): string[];
export function togglePinnedProject(projects: unknown, projectPath: string): string[];
export function readPinnedProjects(storage?: Pick<Storage, 'getItem'>): string[];
export function writePinnedProjects(projects: unknown, storage?: Pick<Storage, 'setItem'>): void;
