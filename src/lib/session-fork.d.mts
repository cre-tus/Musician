import type { Session } from '../types';

export function forkSession(
  session: unknown,
  messageId: string,
  options?: { createId?: () => string; now?: number; title?: string },
): Session | null;
