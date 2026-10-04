import type { OpenFile } from '../types';
export function createUnavailableRestoredFile(path: string, draft?: { original?: string; content?: string } | null): OpenFile;
export function reconcileOpenFileDiskState(file: OpenFile, result: { ok: boolean; content?: string; error?: string }): OpenFile;
