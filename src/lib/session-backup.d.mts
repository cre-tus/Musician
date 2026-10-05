export const BACKUP_VERSION: number;
export const BACKUP_MAX_BYTES: number;
export const BACKUP_MAX_SESSIONS: number;
export const BACKUP_MAX_MESSAGES: number;
export interface BackupMessage {
  role: 'user' | 'assistant';
  text: string;
  [key: string]: unknown;
}
export interface BackupSession {
  title: string;
  cwd?: string;
  createdAt?: number;
  engine?: 'msp' | 'exec';
  pinned: boolean;
  messages: BackupMessage[];
}
export type ParseBackupResult =
  | { ok: true; sessions: BackupSession[] }
  | { ok: false; error: string };
export function createSessionBackup(sessions: unknown, options?: { exportedAt?: number }): string;
export function parseSessionBackup(text: unknown): ParseBackupResult;
export function toImportSessions(
  parsedSessions: unknown,
  options?: { createId?: () => string; now?: number },
): Array<{
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
  engine?: 'msp' | 'exec';
  pinned: boolean;
  archived: boolean;
  messages: Array<BackupMessage & { id: string; ts: number; done: boolean }>;
}>;
