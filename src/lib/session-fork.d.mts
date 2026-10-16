import type { Session } from '../types';

export function forkSession(
  session: unknown,
  messageId: string,
  options?: {
    createId?: () => string;
    now?: number;
    title?: string;
    editedText?: string;
    origin?: { sessionId: string; messageId: string } | null;
  },
): Session | null;
