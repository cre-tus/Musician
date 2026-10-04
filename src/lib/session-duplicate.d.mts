import type { Session } from '../types';
export function duplicateSession(session: unknown, options?: { now?: number; lang?: 'ko' | 'en' } | null): Session | null;
