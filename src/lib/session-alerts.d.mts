export function isUnread(ids: string[], id: string): boolean;
export function markUnread(ids: string[], id: string): string[];
export function clearUnread(ids: string[], id: string): string[];
export interface StopRegistry {
  register(id: string, stop: (() => void) | null | undefined): void;
  request(id: string): boolean;
  has(id: string): boolean;
}
export function createStopRegistry(): StopRegistry;
