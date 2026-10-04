import type { Session } from '../types';

export function formatSessionTranscript(
  session: Session,
  options?: { exportedAt?: number; projectFallback?: string; lang?: 'ko' | 'en' },
): string;
export function formatSessionTranscripts(
  sessions: Session[],
  options?: { exportedAt?: number; projectFallback?: string; lang?: 'ko' | 'en' },
): string;
