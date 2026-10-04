export type SidebarGroupState = Record<string, boolean>;
export function parseSidebarGroupState(serialized: string): SidebarGroupState;
export function toggleSidebarGroup(state: SidebarGroupState, key: string): SidebarGroupState;
