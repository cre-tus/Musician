import type { PaneTab } from '../types';
export function workspacePaneLayoutKey(folder: string): string;
export function serializeWorkspacePaneLayout(folder: string, tabs: PaneTab[], activeTabId: string): { version: 1; folder: string; tabs: Array<Record<string, unknown>>; activeTabId: string };
export function mergeLiveWorkspaceTabs<T extends PaneTab>(restoredTabs: T[], liveTabs: T[]): T[];
export function readWorkspacePaneLayout(folder: string, storage?: Pick<Storage, 'getItem'>): { tabs: unknown[]; activeTabId?: unknown; folder?: string; version?: number } | null;
export function writeWorkspacePaneLayout(folder: string, tabs: PaneTab[], activeTabId: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): boolean;
export function removeTabFromStoredWorkspaceLayouts(tabId: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>): boolean;
