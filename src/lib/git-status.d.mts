import type { GitStatusKind } from '../types';

export function porcelainPath(entry: string): string;
export function porcelainStatus(entry: string): GitStatusKind;
export function porcelainStaged(entry: string): boolean;
export function normalizeCommitMessage(message: string): { ok: boolean; message?: string; error?: string };
export function parseUpstreamCounts(output: string): { ahead: number; behind: number };
