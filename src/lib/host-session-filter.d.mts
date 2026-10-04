import type { HostSession } from '../types';
export function readHiddenHostSessionIds(storage?: unknown): string[];
export function hideHostSessionId(id: string, storage?: unknown): string[];
export function visibleHostSessions(list: HostSession[], hiddenIds?: string[]): HostSession[];
export function hostSessionDateStrings(session: HostSession): string[];
export function matchesHostSessionQuery(session: HostSession, query: string): boolean;
export function filterHostSessions(list: HostSession[], query: string, hiddenIds?: string[]): HostSession[];
