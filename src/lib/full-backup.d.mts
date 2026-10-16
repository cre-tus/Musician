export declare const FULL_BACKUP_VERSION: number;
export interface FullBackupData {
  sessions: unknown[];
  settings: Record<string, unknown>;
  memories: unknown[];
  slashCommands: unknown[];
  schedules: unknown[];
  verifyCommands: Record<string, { name: string; cmd: string }[]>;
}
export declare function createFullBackup(
  parts: {
    sessions?: unknown;
    settings?: unknown;
    memories?: unknown;
    slashCommands?: unknown;
    schedules?: unknown;
    verifyCommands?: unknown;
  } | null | undefined,
  options?: { exportedAt?: number },
): string;
export declare function parseFullBackup(text: string): { ok: true; data: FullBackupData } | { ok: false; error: string };
