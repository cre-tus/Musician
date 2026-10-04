export interface SidebarSessionFilter { type: 'is' | 'has' | 'in'; value: string }
export function parseSidebarSessionQuery(value: string): { text: string; filters: SidebarSessionFilter[] };
export function matchesSidebarSessionQuery(session: { id: string; cwd?: string; pinned?: boolean; archived?: boolean }, filters: SidebarSessionFilter[], state?: { runningIds?: string[]; failedIds?: string[]; draftIds?: string[]; queuedIds?: string[] }): boolean;
